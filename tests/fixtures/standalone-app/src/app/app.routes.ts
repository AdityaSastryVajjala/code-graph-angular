import { Routes } from '@angular/router';
import { UserListComponent } from './user-list.component';

export const routes: Routes = [
  { path: 'users', component: UserListComponent },
  // Phase 2 fixture: lazy-loaded module route (loadChildren)
  { path: 'admin', loadChildren: () => import('./admin/admin.module').then((m) => m.AdminModule) },
  // Phase 2 fixture: lazy-loaded standalone component route (loadComponent)
  { path: 'profile', loadComponent: () => import('./profile/profile.component').then((c) => c.ProfileComponent) },
  { path: '', redirectTo: '/users', pathMatch: 'full' },
];
