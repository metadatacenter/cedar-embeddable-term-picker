import { provideBrowserGlobalErrorListeners } from '@angular/core';
import { createCustomElement } from '@angular/elements';
import { createApplication } from '@angular/platform-browser';
import { CETP_TAG, CedarEmbeddableTermPicker } from './app/cedar-embeddable-term-picker';

/**
 * Register the picker as a custom element.
 *
 * `createApplication` rather than `bootstrapApplication`: nothing on the page is
 * bootstrapped by us. The host decides where and when a `<cedar-embeddable-term-picker>` appears,
 * and the application exists only to give the element an injector.
 *
 * The registration is guarded because `customElements.define` throws on a tag that is
 * already defined, and a host page that loads two copies of this bundle would otherwise
 * fail on the second rather than keep the one it has.
 */
createApplication({ providers: [provideBrowserGlobalErrorListeners()] })
  .then((application) => {
    if (customElements.get(CETP_TAG)) {
      console.warn(`<${CETP_TAG}> is already defined; this bundle is not the one serving it.`);
      return;
    }
    customElements.define(CETP_TAG, createCustomElement(CedarEmbeddableTermPicker, { injector: application.injector }));
  })
  .catch((error: unknown) => console.error(error));
