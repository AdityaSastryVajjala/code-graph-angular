import { Component } from '@angular/core';
import { SharedComponent } from '../../../../libs/shared/src/lib/shared.component';

@Component({
  selector: 'admin-dashboard',
  standalone: true,
  imports: [SharedComponent],
  template: `
    <lib-shared></lib-shared>
    <h1>Admin Dashboard</h1>
  `,
})
export class DashboardComponent {}
