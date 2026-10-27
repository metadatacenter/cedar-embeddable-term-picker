import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';

/**
 * The host-fonts build's font registrar, which registers no faces.
 *
 * `angular.json`'s `host-fonts` configuration builds with this file in place of
 * `font-registrar.ts`. A host page that loads several CEDAR components registers CEDAR Roboto
 * 400 and 500 once for all of them, so this build carries none of its own. The element and its
 * place in the picker's template stay the same.
 */
@Component({
  selector: 'cetp-font-registrar',
  template: '',
  styleUrl: './font-registrar.host-fonts.scss',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FontRegistrar {}
