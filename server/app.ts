import 'dotenv/config';
import express from 'express';
import { registerRoutes } from './routes.ts';

export const app = express();

registerRoutes(app);
