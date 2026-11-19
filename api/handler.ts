import type { Request, Response } from 'express';
import { app } from '../server/app.ts';

export default function handler(req: Request, res: Response): void {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const apiPath = requestUrl.searchParams.get('__api_path');

  if (!apiPath || !apiPath.startsWith('/') || apiPath.startsWith('//')) {
    res.status(400).json({ error: 'Invalid API dispatch path.' });
    return;
  }

  requestUrl.searchParams.delete('__api_path');
  const query = requestUrl.searchParams.toString();
  req.url = `/api${apiPath}${query ? `?${query}` : ''}`;

  app.handle(req, res);
}
