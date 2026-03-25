import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { AppComponent } from './app.component';
import { AppHeaderComponent } from './app-header.component';
import { UserComponent } from './user.component';
import { UserService } from './user.service';
import { HighlightDirective } from './highlight.directive';
import { TruncatePipe } from './truncate.pipe';
import { routes } from './app.routes';

@NgModule({
  declarations: [
    AppComponent,
    AppHeaderComponent,
    UserComponent,
    HighlightDirective,
    TruncatePipe,
  ],
  imports: [
    BrowserModule,
    RouterModule.forRoot(routes),
  ],
  providers: [UserService],
  bootstrap: [AppComponent],
})
export class AppModule {}
