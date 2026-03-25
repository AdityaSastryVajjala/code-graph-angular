import { Component } from '@angular/core';
import { SharedComponent } from '../../../../libs/shared/src/lib/shared.component';

@Component({
  selector: 'reporting-dashboard',
  standalone: true,
  imports: [SharedComponent],
  template: `
    <lib-shared></lib-shared>
    <h1>Reporting Dashboard</h1>
  `,
})
export class DashboardComponent {}
