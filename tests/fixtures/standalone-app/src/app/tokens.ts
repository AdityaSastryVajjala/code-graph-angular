/** Phase 2 fixture: InjectionToken declarations. */

import { InjectionToken } from '@angular/core';

export const API_URL = new InjectionToken<string>('api-base-url');
export const MAX_RETRIES = new InjectionToken<number>('max-http-retries');
