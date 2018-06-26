const Joi = require('joi');

const fields = {
  exemptLabels: Joi.array()
    .single()
    .items(Joi.string())
    .description(
      'Issues and pull requests with these labels accept reaction comments. Set to `[]` to disable'
    ),

  reactionComment: Joi.alternatives()
    .try(Joi.string(), Joi.boolean().only(false))
    .description(
      'Replace matching comments with this message, `{user}` is a placeholder for the comment author. Set to `false` to disable'
    )
};

const schema = Joi.object().keys({
  exemptLabels: fields.exemptLabels.default([]),
  reactionComment: fields.reactionComment.default(
    ':wave: @{user}, did you mean to use a [reaction](https://git.io/vhzhC) instead?'
  ),
  only: Joi.string()
    .valid('issues', 'pulls')
    .description('Limit to only `issues` or `pulls`'),
  pulls: Joi.object().keys(fields),
  issues: Joi.object().keys(fields),
  _extends: Joi.string().description('Repository to extend settings from'),
  perform: Joi.boolean().default(!process.env.DRY_RUN)
});

module.exports = schema;
