# Deploying

If you would like to run your own instance of this app, see the
[docs for deployment](https://probot.github.io/docs/deployment/).

This app requires these **Permissions & events** for the GitHub App:

- Issues - **Read & Write**
  - [x] Check the box for **Issue comment** events
- Pull requests - **Read & Write**
  - [x] Check the box for **Pull request review comment** events
- Repository metadata - **Read-only**
- Single File - **Read-only**
  - Path: `.github/reaction.yml`
