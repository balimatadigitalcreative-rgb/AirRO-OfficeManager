'use strict';
const { z } = require('zod');
const authService = require('../services/auth.service');
const asyncHandler = require('../utils/asyncHandler');

const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  // Usernames are case-INSENSITIVE: stored + matched lowercase so "Gusde17" == "gusde17".
  username: z.string().trim().toLowerCase().min(3).max(40).regex(/^[a-z0-9._-]+$/,
    'Username may contain only letters, numbers, dot, underscore and hyphen'),
  password: z.string().min(6).max(200),
  role: z.string().trim().min(1).max(40).default('finance'),
  sub: z.string().trim().max(120).optional(),
  color: z.string().trim().max(20).optional(),
});

const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1),   // case-insensitive login
  password: z.string().min(1),
});

// Forgot password — public. The username is all that's required (+ an optional note).
const forgotSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(40),
  note: z.string().trim().max(300).optional(),
});

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Password baru minimal 8 karakter').max(200),
});

// Self profile edit — only display name + avatar colour. Role/permissions/username
// are deliberately absent so a user can never elevate their own access here.
const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  color: z.string().trim().max(20).optional(),
}).refine((d) => d.name !== undefined || d.color !== undefined, { message: 'Nothing to update' });

const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body);
  res.status(201).json(result);
});

const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body);
  res.status(200).json(result);
});

// Always returns the SAME generic message whether or not the username exists (no enumeration).
const forgot = asyncHandler(async (req, res) => {
  await authService.requestPasswordReset(req.body);
  res.status(200).json({ ok: true, message: 'Permintaan dikirim ke admin. Hubungi owner/HRD Anda.' });
});

const me = asyncHandler(async (req, res) => {
  const user = await authService.me(req.user.id);
  res.status(200).json({ user });
});

const changePassword = asyncHandler(async (req, res) => {
  await authService.changePassword(req.user.id, req.body.oldPassword, req.body.newPassword);
  res.status(200).json({ data: { ok: true } });
});

const updateProfile = asyncHandler(async (req, res) => {
  const user = await authService.updateProfile(req.user.id, req.body);
  res.status(200).json({ user });
});

module.exports = { register, login, forgot, me, changePassword, updateProfile, schemas: { registerSchema, loginSchema, forgotSchema, changePasswordSchema, updateProfileSchema } };
