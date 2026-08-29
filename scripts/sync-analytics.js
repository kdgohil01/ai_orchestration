import dotenv from 'dotenv';
import { syncAnalyticsMetrics } from '../core/analytics.js';
dotenv.config();

syncAnalyticsMetrics()
  .then(result => console.log(`Analytics updated for ${result.updated} videos.`))
  .catch(err => { console.error(err.message); process.exitCode = 1; });
