const uuidV4 = require('uuid/v4');
const firebase = require('firebase-admin');
const createScheduler = require('probot-scheduler');
const getMergedConfig = require('probot-config');

const App = require('./reaction');
const schema = require('./schema');

module.exports = async robot => {
  const firebaseApp = firebase.initializeApp({
    credential: firebase.credential.cert(process.env.FIREBASE_KEY_PATH),
    databaseURL: process.env.FIREBASE_DB_URL
  });
  const db = firebaseApp.database();

  const github = await robot.auth();
  const appName = (await github.apps.get({})).data.name;

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
    const logger = context.log.child({appName, session: uuidV4()});
    const config = await getConfig(context, logger);
    if (config && config.perform) {
      return new App(context, config, logger, db);
    }
  }

  async function getConfig(context, log, file = 'reaction.yml') {
    let config;
    const repo = context.repo();
    try {
      let repoConfig = await getMergedConfig(context, file);
      if (!repoConfig) {
        repoConfig = {perform: false};
      }
      const {error, value} = schema.validate(repoConfig);
      if (error) {
        throw error;
      }
      config = value;
    } catch (err) {
      log.warn({err: new Error(err), repo, file}, 'Invalid config');
    }

    return config;
  }
};
