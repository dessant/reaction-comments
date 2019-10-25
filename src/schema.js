const Joi = require('@hapi/joi');

const fields = {
  exemptLabels: Joi.array()
    .single()
    .items(
      Joi.string()
        .trim()
        .max(50)
    )
    .description(
      'Issues and pull requests with these labels accept reaction comments. ' +
        'Set to `[]` to disable'
    ),

  reactionComment: Joi.alternatives()
    .try(
      Joi.string()
        .trim()
        .max(10000),
      Joi.boolean().only(false)
    )
    .description(
      'Replace matching comments with this message, `{comment-author}` ' +
        'is an optional placeholder. Set to `false` to disable'
    )
};

const schema = Joi.object().keys({
  exemptLabels: fields.exemptLabels.default([]),
  reactionComment: fields.reactionComment.default(
    ':wave: @{comment-author}, would you like to leave ' +
      'a [reaction](https://git.io/vhzhC) instead?'
  ),
  only: Joi.string()
    .trim()
    .valid('issues', 'pulls')
    .description('Limit to only `issues` or `pulls`'),
  pulls: Joi.object().keys(fields),
  issues: Joi.object().keys(fields),
  _extends: Joi.string()
    .trim()
    .max(260)
    .description('Repository to extend settings from'),
  perform: Joi.boolean().default(!process.env.DRY_RUN)
});

module.exports = schema;
