const dedent = require('dedent');

const reactionRx = /^(?:\s*(?:\+1|-1|:(?:\+1|-1|thumbsup|thumbsdown|smile|tada|confused|heart):|\u{1f44d}(?:\u{1f3fb}|\u{1f3fc}|\u{1f3fd}|\u{1f3fe}|\u{1f3ff})?|\u{1f44e}(?:\u{1f3fb}|\u{1f3fc}|\u{1f3fd}|\u{1f3fe}|\u{1f3ff})?|\u{1f604}|\u{1f389}|\u{1f615}|\u{2764}\u{fe0f})\s*)+$/u;

module.exports = class Reaction {
  constructor(context, config, logger, db) {
    this.context = context;
    this.config = config;
    this.log = logger;
    this.db = db;
  }

  async comment() {
    const {isBot, payload, github} = this.context;
    const issue = this.context.issue();

    if (isBot) {
      return;
    }

    const isReviewComment = payload.comment.hasOwnProperty('commit_id');

    const {only} = this.config;
    const type =
      isReviewComment || payload.issue.pull_request ? 'pulls' : 'issues';
    if (only && only !== type) {
      return;
    }

    const exemptLabels = this.getConfigValue(type, 'exemptLabels');
    if (exemptLabels.length) {
      const labels = (payload.issue || payload.pull_request).labels.map(
        label => label.name
      );
      for (const label of exemptLabels) {
        if (labels.includes(label)) {
          return;
        }
      }
    }

    const commentId = payload.comment.id;
    const commentParams = {
      owner: issue.owner,
      repo: issue.repo,
      comment_id: commentId
    };
    const commentBody = payload.comment.body;
    if (!reactionRx.test(commentBody)) {
      return;
    }

    const {data: issueData} = await github.issues.get({
      ...issue,
      headers: {
        Accept: 'application/vnd.github.sailor-v-preview+json'
      }
    });
    const lock = {
      active: issueData.locked,
      reason: issueData.active_lock_reason
    };

    let reactionComment = this.getConfigValue(type, 'reactionComment');
    const GhResource = isReviewComment ? github.pullRequests : github.issues;

    if (!reactionComment) {
      this.log.info({issue, commentId}, 'Deleting comment');
      await this.ensureUnlock(issue, lock, () =>
        GhResource.deleteComment(commentParams)
      );
      return;
    }

    reactionComment = reactionComment.replace(
      /{(?:user|comment-author)}/,
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

      ${commentBody}
      </details>
      </h6>
    `;

    this.log.info({issue, commentId}, 'Editing comment');
    await this.ensureUnlock(issue, lock, () =>
      GhResource.editComment({...commentParams, body: editedComment})
    );

    await this.getStorage(
      `comments/${payload.installation.id}/${payload.repository.id}`
    ).push({
      dt: Date.now(),
      isReviewComment,
      commentId,
      issue: issue.number
    });
  }

  async delete() {
    const {payload, github} = this.context;

    const commentsRef = this.getStorage(
      `comments/${payload.installation.id}/${payload.repository.id}`
    );
    const comments = await commentsRef.limitToFirst(100).once('value');

    const outdatedComments = [];
    comments.forEach(item => {
      const comment = item.val();
      // delete comments older than a day
      if (comment.dt < Date.now() - 86400000) {
        outdatedComments.push({dbKey: item.key, ...comment});
      } else {
        return true;
      }
    });

    if (outdatedComments.length) {
      const {owner, repo} = this.context.repo();
      for (const comment of outdatedComments) {
        const commentParams = {
          owner,
          repo,
          comment_id: comment.commentId
        };
        const GhResource = comment.isReviewComment
          ? github.pullRequests
          : github.issues;

        let commentData;
        try {
          commentData = (await GhResource.getComment(commentParams)).data;
        } catch (e) {
          if (e.code === 404) {
            continue;
          }
          throw e;
        }
        const commentBody = commentData.body;
        if (/<!--notice-->/.test(commentBody) || reactionRx.test(commentBody)) {
          const issue = {owner, repo, number: comment.issue};
          const {data: issueData} = await github.issues.get({
            ...issue,
            headers: {
              Accept: 'application/vnd.github.sailor-v-preview+json'
            }
          });
          const lock = {
            active: issueData.locked,
            reason: issueData.active_lock_reason
          };

          this.log.info(
            {issue, commentId: comment.commentId},
            'Deleting comment'
          );
          await this.ensureUnlock(issue, lock, () =>
            GhResource.deleteComment(commentParams)
          );
        }
      }

      await commentsRef.update(
        Object.assign(
          ...outdatedComments.map(function(item) {
            return {[item.dbKey]: null};
          })
        )
      );
    }
  }

  static getStorageStatic(db, path) {
    if (process.env.NODE_ENV !== 'production') {
      path = `dev/${path}`;
    }
    return db.ref(path);
  }

  getStorage(path) {
    return Reaction.getStorageStatic(this.db, path);
  }

  async ensureUnlock(issue, lock, action) {
    if (lock.active) {
      await this.context.github.issues.unlock(issue);
      await action();
      if (lock.reason) {
        issue = {
          ...issue,
          lock_reason: lock.reason,
          headers: {
            Accept: 'application/vnd.github.sailor-v-preview+json'
          }
        };
      }
      await this.context.github.issues.lock(issue);
    } else {
      await action();
    }
  }

  getConfigValue(type, key) {
    if (this.config[type] && typeof this.config[type][key] !== 'undefined') {
      return this.config[type][key];
    }
    return this.config[key];
  }
};
