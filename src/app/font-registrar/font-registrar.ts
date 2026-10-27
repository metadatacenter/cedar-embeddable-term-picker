import { ChangeDetectionStrategy, Component, CSP_NONCE, DOCUMENT, inject } from '@angular/core';
import { registerFontFaces } from '@org.metadatacenter/cedar-design-tokens/font-faces';

/**
 * Puts the picker's embedded fonts into the document's font set.
 *
 * Browsers do not register `@font-face` declared inside a shadow root, so the faces go into the
 * document's head, once for every CEDAR component on the page: CEE and the designer register the
 * same set the same way. Declared as the styles of an unencapsulated component, as they were,
 * Angular also copied them into every shadow root, where nothing reads them.
 */
@Component({
  selector: 'cetp-font-registrar',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FontRegistrar {
  constructor() {
    registerFontFaces(inject(DOCUMENT), inject(CSP_NONCE, { optional: true }));
  }
}
