import { Component } from '@angular/core';
import { ButtonComponent } from '@shared-ui/button.component';
import { DataService } from '@data-access/data.service';
import { inject } from '@angular/core';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ButtonComponent],
  template: `
    <h1>Shell App</h1>
    <lib-button [label]="title" (clicked)="onButtonClick()"></lib-button>
  `,
})
export class AppComponent {
  title = 'shell';
  private dataService = inject(DataService);

  onButtonClick(): void {
    void this.dataService.getData();
  }
}
