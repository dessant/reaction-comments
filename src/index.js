const firebase = require('firebase-admin');
const createScheduler = require('probot-scheduler');
const getMergedConfig = require('probot-config');

const App = require('./reaction');
const schema = require('./schema');

module.exports = robot => {
  firebase.initializeApp({
    credential: firebase.credential.cert(process.env.FIREBASE_KEY_PATH),
    databaseURL: process.env.FIREBASE_DB_URL
  });
  const db = firebase.database();

  const scheduler = createScheduler(robot);

  robot.on('issue_comment.created', async context => {
    const app = await getApp(context);
    if (app) {
      await app.comment();
    }
  });

  robot.on('pull_request_review_comment.created', async context => {
    const app = await getApp(context);
    if (app) {
      await app.comment();
    }
  });

  robot.on('schedule.repository', async context => {
    const app = await getApp(context);
    if (app) {
      await app.delete();
    }
  });

  robot.on('installation.deleted', async context => {
    await removeInstallation(context.payload.installation.id);
  });

  robot.on('installation_repositories.removed', async context => {
    await removeRepositories(
      context.payload.installation.id,
      context.payload.repositories_removed
    );
  });

  async function removeInstallation(installationId) {
    await App.getStorageStatic(db, `comments/${installationId}`).remove();
  }

  async function removeRepositories(installationId, repos) {
    repos.forEach(item => scheduler.stop(item));

    await App.getStorageStatic(db, `comments/${installationId}`).update(
      Object.assign(
        ...repos.map(function(item) {
          return {[item.id]: null};
        })
      )
    );
  }

  async function getApp(context) {
    const config = await getConfig(context);
    if (config) {
      return new App(context, config, robot.log, db);
    }
  }

  async function getConfig(context) {
    const {owner, repo} = context.repo();
    let config;
    try {
      const repoConfig = await getMergedConfig(context, 'reaction.yml');
      if (repoConfig) {
        const {error, value} = schema.validate(repoConfig);
        if (error) {
          throw error;
        }
        config = value;
      }
    } catch (err) {
      robot.log.warn({err: new Error(err), owner, repo}, 'Invalid config');
    }

    return config;
  }
};
