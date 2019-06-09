# Reaction Comments

[![Build Status](https://img.shields.io/travis/com/dessant/reaction-comments/master.svg)](https://travis-ci.com/dessant/reaction-comments)
[![Version](https://img.shields.io/npm/v/reaction-comments.svg?colorB=007EC6)](https://www.npmjs.com/package/reaction-comments)

Reaction Comments is a GitHub App built with [Probot](https://github.com/probot/probot)
that deletes reaction comments, such as +1, and encourages the use of GitHub
reactions.

![](assets/screenshot.png)

## Supporting the Project

The continued development of Reaction Comments is made possible
thanks to the support of awesome backers. If you'd like to join them,
please consider contributing with [Patreon](https://www.patreon.com/dessant),
[PayPal](https://www.paypal.me/ArminSebastian) or [Bitcoin](https://goo.gl/uJUAaU).

## How It Works

The app detects if a new comment consists solely of emojis and shortcodes
used in GitHub reactions. A matching comment is either replaced
with the message set in `reactionComment` and deleted after a day,
or it is deleted immediately, if `reactionComment` is set to `false`.

## Usage

1. **[Install the GitHub App](https://github.com/apps/reaction)**
   for the intended repositories
2. Create `.github/reaction.yml` based on the template below

⚠️ **If possible, install the app only for select repositories.
Do not leave the `All repositories` option selected, unless you intend
to use the app for all current and future repositories.**

#### Configuration

Create `.github/reaction.yml` in the default branch to enable the app,
or add it at the same file path to a repository named `.github`.
The file can be empty, or it can override any of these default settings:

```yaml
# Configuration for Reaction Comments - https://github.com/dessant/reaction-comments

# Issues and pull requests with these labels accept reaction comments.
# Set to `[]` to disable
exemptLabels: []

# Replace matching comments with this message, `{comment-author}` is an
# optional placeholder. Set to `false` to disable
reactionComment: >
  :wave: @{comment-author}, would you like to leave
  a [reaction](https://git.io/vhzhC) instead?

# Limit to only `issues` or `pulls`
# only: issues

# Optionally, specify configuration settings just for `issues` or `pulls`
# issues:
#   exemptLabels:
#     - party-parrot

# pulls:
#   reactionComment: false

# Repository to extend settings from
# _extends: repo
```

## Deployment

See [docs/deploy.md](docs/deploy.md) if you would like to run your own
instance of this app.

## License

Copyright (c) 2018-2019 Armin Sebastian

This software is released under the terms of the MIT License.
See the [LICENSE](LICENSE) file for further information.
