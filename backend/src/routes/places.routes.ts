import { Router } from 'express';
import { asyncHandler, badRequest } from '../lib/errors.js';
import { getUser } from '../middleware/auth.js';
import { searchPlaces } from '../services/geocoding.js';

export const placesRouter = Router();

placesRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    getUser(req);
    const query = String(req.query.q || '').trim();
    if (!query) throw badRequest('Query parameter q is required');

    const biasLat = req.query.biasLat != null && req.query.biasLat !== '' ? Number(req.query.biasLat) : undefined;
    const biasLng = req.query.biasLng != null && req.query.biasLng !== '' ? Number(req.query.biasLng) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 6;

    const places = await searchPlaces(query, { biasLat, biasLng, limit });
    res.json({ places });
  }),
);
