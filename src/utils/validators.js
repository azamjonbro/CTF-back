import Joi from 'joi';

export const registerSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(8).max(100).required(),
  name: Joi.string().max(50).allow(''),
  surname: Joi.string().max(50).allow(''),
  age: Joi.number().integer().min(10).max(120).allow(null),
  country: Joi.string().max(100).allow(''),
  captchaId: Joi.string().hex().length(24).optional(),
  captchaAnswer: Joi.any().optional()
});

export const loginSchema = Joi.object({
  usernameOrEmail: Joi.string().required(),
  password: Joi.string().required(),
  deviceName: Joi.string().max(500).default('Generic Web Browser'),
  captchaId: Joi.string().hex().length(24).optional(),
  captchaAnswer: Joi.any().optional()
});

export const teamCreateSchema = Joi.object({
  name: Joi.string().min(3).max(50).required()
});

export const teamInviteSchema = Joi.object({
  inviteCode: Joi.string().hex().length(12).required()
});

const questionSchema = Joi.object({
  title: Joi.string().required(),
  description: Joi.string().required(),
  points: Joi.number().integer().min(10).default(10).optional(),
  answer: Joi.string().required(),
  hint: Joi.string().allow('').optional()
});

export const ctfCreateSchema = Joi.object({
  title: Joi.string().min(3).max(100).required(),
  shortDescription: Joi.string().max(250).required(),
  longDescription: Joi.string().required(),
  difficulty: Joi.string().valid('easy', 'medium', 'hard').required(),
  stars: Joi.number().integer().min(1).required(),
  points: Joi.number().integer().min(0).default(100).optional(),
  category: Joi.string().required(),
  timerMinutes: Joi.number().integer().min(1).required(),
  image: Joi.string().allow('').optional(),
  attachments: Joi.array().items(Joi.string().allow('')).optional(),
  hint: Joi.string().allow('').optional(),
  flags: Joi.array().items(Joi.string().required()).min(1).max(3).required(),
  questions: Joi.array().items(questionSchema).min(5).max(10).required()
});

export const hackathonCreateSchema = Joi.object({
  name: Joi.string().min(3).max(100).required(),
  description: Joi.string().required(),
  banner: Joi.string().allow(''),
  coverImage: Joi.string().allow(''),
  hackathonStart: Joi.date().required(),
  hackathonEnd: Joi.date().required(),
  maxTeams: Joi.number().integer().min(2).max(1000).required(),
  challenges: Joi.array().items(Joi.string().hex().length(24)).default([])
});

export const hackathonUpdateSchema = Joi.object({
  name: Joi.string().min(3).max(100).required(),
  description: Joi.string().required(),
  banner: Joi.string().allow(''),
  coverImage: Joi.string().allow(''),
  hackathonStart: Joi.date().required(),
  hackathonEnd: Joi.date().required(),
  maxTeams: Joi.number().integer().min(2).max(1000).required(),
  challenges: Joi.array().items(Joi.string().hex().length(24)).default([]),
  status: Joi.string().valid('open', 'closed', 'running', 'finished').optional()
});

export const submitAnswerSchema = Joi.object({
  answer: Joi.string().max(1000).required()
});

export const submitFlagSchema = Joi.object({
  flag: Joi.string().max(1000).required()
});

export const manageRolesSchema = Joi.object({
  targetUserId: Joi.string().hex().length(24).required(),
  action: Joi.string().valid('add', 'remove').required(),
  role: Joi.string().valid('admin', 'staff', 'support', 'team_leader', 'team_member').required()
});

