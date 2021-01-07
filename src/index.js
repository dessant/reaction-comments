const core = require('@actions/core');
const github = require('@actions/github');
const artifact = require('@actions/artifact');
const {writeJson, remove} = require('fs-extra');
const dedent = require('dedent');
const zip = require('adm-zip');

const schema = require('./schema');

const reactionRx = /^(?:\s*(?:\+1|-1|:(?:\+1|-1|thumbsup|thumbsdown|smile|tada|confused|heart|rocket|eyes):|\u{1f44d}(?:\u{1f3fb}|\u{1f3fc}|\u{1f3fd}|\u{1f3fe}|\u{1f3ff})?|\u{1f44e}(?:\u{1f3fb}|\u{1f3fc}|\u{1f3fd}|\u{1f3fe}|\u{1f3ff})?|\u{1f604}|\u{1f389}|\u{1f615}|\u{2764}\u{fe0f}|\u{1f680}|\u{1f440})\s*)+$/u;

async function run() {
  try {
    const config = getConfig();
    const client = github.getOctokit(config['github-token']);

    const app = new App(config, client);

    let output;
    if (github.context.eventName === 'schedule') {
      output = await app.processScheduledComments();
    } else {
      output = await app.processNewComment();
    }

    if (output) {
      core.debug('Setting output (comments)');
      core.setOutput('comments', JSON.stringify(output));
    }
  } catch (err) {
    core.setFailed(err);
  }
}

class App {
  constructor(config, client) {
    this.config = config;
    this.client = client;
  }

  async processNewComment() {
    const payload = github.context.payload;

    if (payload.sender.type === 'Bot') {
      return;
    }

    const commentBody = payload.comment.body;
    if (!reactionRx.test(commentBody)) {
      return;
    }

    const isReviewComment = payload.comment.hasOwnProperty('commit_id');

    const threadType =
      isReviewComment || payload.issue.pull_request ? 'pr' : 'issue';

    const processOnly = this.config['process-only'];
    if (processOnly && processOnly !== threadType) {
      return;
    }

    const exemptLabels = this.config[`exempt-${threadType}-labels`];
    if (exemptLabels) {
      const labels = threadData.labels.map(label => label.name);
      for (const label of exemptLabels) {
        if (labels.includes(label)) {
          return;
        }
      }
    }

    const {owner, repo} = github.context.repo;
    const issue = {owner, repo, issue_number: github.context.issue.number};

    const commentId = payload.comment.id;
    const comment = {owner, repo, comment_id: commentId};

    const threadData = payload.issue || payload.pull_request;
    const lock = {
      active: threadData.locked,
      reason: threadData.active_lock_reason
    };

    let reactionComment = this.config[`${threadType}-comment`];

    if (reactionComment) {
      reactionComment = reactionComment.replace(
        /{comment-author}/,
        payload.comment.user.login
      );

      const editedComment = dedent`
      ${reactionComment}

      <h6>
      <details>
      <!--notice-->
      <summary>
      This comment is scheduled for deletion. Click here to view the original content.
      </summary>
      </br>

      ${dedent(commentBody)}
      </details>
      </h6>
    `;

      core.debug(`Editing comment (comment: ${commentId})`);
      try {
        await this.ensureUnlock(issue, lock, () =>
          (isReviewComment
            ? this.client.pulls.updateReviewComment
            : this.client.issues.updateComment)({
            ...comment,
            body: editedComment
          })
        );
      } catch (err) {
        if (err.status === 404) {
          return;
        } else {
          throw err;
        }
      }

      const storageContent = {
        commentId,
        isReviewComment,
        issueNumber: issue.issue_number
      };

      await this.setWorkflowRunStorage(storageContent);
    } else {
      core.debug(`Deleting comment (comment: ${commentId})`);
      try {
        await this.ensureUnlock(issue, lock, () =>
          (isReviewComment
            ? this.client.pulls.deleteReviewComment
            : this.client.issues.deleteComment)(comment)
        );
      } catch (err) {
        if (err.status === 404) {
          return;
        } else {
          throw err;
        }
      }
    }

    return [
      {
        ...issue,
        comment_id: commentId,
        is_review_comment: isReviewComment,
        status: reactionComment ? 'scheduled' : 'deleted'
      }
    ];
  }

  async processScheduledComments() {
    const {owner, repo} = github.context.repo;

    const {
      data: {workflow_id: workflowId}
    } = await this.client.actions.getWorkflowRun({
      owner,
      repo,
      run_id: github.context.runId
    });

    const {
      data: {
        workflow_runs: [lastScheduledRun]
      }
    } = await this.client.actions.listWorkflowRuns({
      owner,
      repo,
      event: 'schedule',
      status: 'completed',
      per_page: 1,
      workflow_id: workflowId
    });

    let lastProcessedWorkflowRunId;
    let lastScheduledRunArtifactId;

    if (lastScheduledRun) {
      ({
        storage: {lastProcessedWorkflowRunId} = {},
        artifactId: lastScheduledRunArtifactId
      } = await this.getWorkflowRunStorage(lastScheduledRun.id));
    }

    const workflowRuns = await this.client.paginate(
      this.client.actions.listWorkflowRuns,
      {
        owner,
        repo,
        status: 'completed',
        conclusion: 'success',
        per_page: 100,
        workflow_id: workflowId
      },
      function (response, done) {
        const data = [];

        for (const workflowRun of response.data) {
          if (workflowRun.id === lastProcessedWorkflowRunId) {
            done();
            break;
          }

          if (workflowRun.event !== 'schedule') {
            data.push(workflowRun);
          }
        }

        return data;
      }
    );

    const comments = [];

    for (const workflowRun of workflowRuns.reverse()) {
      // only delete comments scheduled more than a day ago
      if (
        Date.now() <
        new Date(workflowRun.created_at).getTime() + 24 * 60 * 60 * 1000
      ) {
        break;
      }

      const workflowRunId = workflowRun.id;

      const {storage, artifactId} = await this.getWorkflowRunStorage(
        workflowRunId
      );

      if (storage) {
        const {commentId, isReviewComment} = storage;
        const issue = {owner, repo, issue_number: storage.issueNumber};
        const comment = {owner, repo, comment_id: commentId};

        let commentBody;
        try {
          ({
            data: {body: commentBody}
          } = await (isReviewComment
            ? this.client.pulls.getReviewComment
            : this.client.issues.getComment)(comment));
        } catch (err) {
          if (err.status === 404) {
            await this.client.actions.deleteArtifact({
              owner,
              repo,
              artifact_id: artifactId
            });

            lastProcessedWorkflowRunId = workflowRunId;

            continue;
          } else {
            throw err;
          }
        }

        if (/<!--notice-->/.test(commentBody) || reactionRx.test(commentBody)) {
          const {data: issueData} = await this.client.issues.get({
            ...issue,
            headers: {
              Accept: 'application/vnd.github.sailor-v-preview+json'
            }
          });

          const lock = {
            active: issueData.locked,
            reason: issueData.active_lock_reason
          };

          core.debug(`Deleting comment (comment: ${commentId})`);
          await this.ensureUnlock(issue, lock, () =>
            (isReviewComment
              ? this.client.pulls.deleteReviewComment
              : this.client.issues.deleteComment)(comment)
          );

          await this.client.actions.deleteArtifact({
            owner,
            repo,
            artifact_id: artifactId
          });

          comments.push({
            ...issue,
            comment_id: commentId,
            is_review_comment: isReviewComment,
            status: 'deleted'
          });
        }
      }

      lastProcessedWorkflowRunId = workflowRunId;
    }

    if (lastProcessedWorkflowRunId) {
      const storageContent = {lastProcessedWorkflowRunId};

      await this.setWorkflowRunStorage(storageContent);
    }

    if (lastScheduledRunArtifactId) {
      await this.client.actions.deleteArtifact({
        owner,
        repo,
        artifact_id: lastScheduledRunArtifactId
      });
    }

    if (comments.length) {
      return comments;
    }
  }

  async getWorkflowRunStorage(runId) {
    const {owner, repo} = github.context.repo;

    const {
      data: {artifacts}
    } = await this.client.actions.listWorkflowRunArtifacts({
      owner,
      repo,
      run_id: runId
    });

    const artifact = artifacts.find(
      item => item.name === 'storage' && !item.expired
    );

    if (artifact) {
      const {data: archive} = await this.client.actions.downloadArtifact({
        owner,
        repo,
        artifact_id: artifact.id,
        archive_format: 'zip'
      });

      const storage = JSON.parse(
        new zip(Buffer.from(archive)).readAsText('storage.json')
      );

      return {storage, artifactId: artifact.id};
    }

    return {};
  }

  async setWorkflowRunStorage(storageContent) {
    const storagePath = 'storage.json';

    await writeJson(storagePath, storageContent);

    const artifactClient = artifact.create();
    const artifactName = 'storage';
    const artifactFiles = [storagePath];
    const artifactRootDirectory = '.';
    const artifactOptions = {
      continueOnError: false,
      retentionDays: 60
    };

    const uploadResult = await artifactClient.uploadArtifact(
      artifactName,
      artifactFiles,
      artifactRootDirectory,
      artifactOptions
    );

    await remove(storagePath);

    if (uploadResult.failedItems.length) {
      throw new Error('Artifact could not be uploaded');
    }
  }

  async ensureUnlock(issue, lock, action) {
    if (lock.active) {
      if (!lock.hasOwnProperty('reason')) {
        const {data: issueData} = await this.client.issues.get({
          ...issue,
          headers: {
            Accept: 'application/vnd.github.sailor-v-preview+json'
          }
        });
        lock.reason = issueData.active_lock_reason;
      }
      await this.client.issues.unlock(issue);

      let actionError;
      try {
        await action();
      } catch (err) {
        actionError = err;
      }

      if (lock.reason) {
        issue = {
          ...issue,
          lock_reason: lock.reason,
          headers: {
            Accept: 'application/vnd.github.sailor-v-preview+json'
          }
        };
      }
      await this.client.issues.lock(issue);

      if (actionError) {
        throw actionError;
      }
    } else {
      await action();
    }
  }
}

function getConfig() {
  const input = Object.fromEntries(
    Object.keys(schema.describe().keys).map(item => [item, core.getInput(item)])
  );

  const {error, value} = schema.validate(input, {abortEarly: false});
  if (error) {
    throw error;
  }

  return value;
}

run();
