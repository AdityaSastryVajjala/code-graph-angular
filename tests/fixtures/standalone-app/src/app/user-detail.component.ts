/** Phase 3 fixture: standalone component with external template for template-binding extraction tests. */

import { Component, Input, Output, EventEmitter } from '@angular/core';
import { NgIf } from '@angular/common';
import { UpperCasePipe } from '@angular/common';
import { AuthService } from './auth.service';
import { inject } from '@angular/core';

@Component({
  selector: 'app-user-detail',
  standalone: true,
  imports: [NgIf, UpperCasePipe],
  templateUrl: './user-detail.component.html',
})
export class UserDetailComponent {
  @Input() title: string = '';
  @Input() value: string = '';

  name: string = '';
  isVisible: boolean = true;

  @Output() saved = new EventEmitter<void>();

  private authService = inject(AuthService);

  handler(): void {
    void this.authService;
    this.saved.emit();
  }
}
