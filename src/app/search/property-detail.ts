import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { TerminologyClient } from './terminology-client';
import { PropertyHit, PropertyHierarchy, PropertySummary, VersionInfo } from './search-types';

@Component({
  selector: 'cetp-property-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-label="Property details">
      @if (allowVersions()) {
        <label
          >Ontology release
          <select aria-label="Property ontology release" [value]="current().versionId" (change)="changeVersion($event)">
            @for (version of versions(); track version.id) {
              <option [value]="version.id">{{ version.declaredVersion || version.effectiveDate || version.id }}</option>
            }
          </select>
        </label>
      }
      @if (loading()) {
        <p role="status">Reading property…</p>
      }
      @if (error(); as message) {
        <p role="alert">{{ message }}</p>
      }
      @if (hierarchy(); as tree) {
        <h3>{{ tree.selected.property.label }}</h3>
        <p class="iri">{{ tree.selected.property.iri }}</p>
        <p>{{ tree.selected.property.kind }} property</p>
        @for (literal of tree.selected.property.literals; track $index) {
          @if (isDescription(literal.predicate)) {
            <p>
              {{ literal.value }}
              @if (literal.lang) {
                ({{ literal.lang }})
              }
            </p>
          }
        }
        <h4>Parents</h4>
        @for (iri of tree.selected.property.parents; track iri) {
          @if (ancestor(iri); as parent) {
            <button type="button" (click)="navigate(parent)">{{ parent.label }}</button>
          } @else {
            <p>{{ iri }} (not held in this snapshot)</p>
          }
        } @empty {
          <p>No parent properties.</p>
        }
        <h4>Children</h4>
        @for (child of tree.children; track child.iri) {
          <button type="button" (click)="navigate(child)">{{ child.label }}</button>
        } @empty {
          <p>No child properties.</p>
        }
        @if (more()) {
          <button type="button" [disabled]="loading()" (click)="loadMore()">More children</button>
        }
        <p>
          <button type="button" [disabled]="loading() || !!error()" (click)="chosen.emit(current())">
            Select property
          </button>
        </p>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      padding: 12px 20px;
    }
    section {
      font: inherit;
    }
    button,
    select {
      font: inherit;
      margin: 3px;
      padding: 4px 8px;
    }
    h3,
    h4,
    p {
      margin: 8px 0;
    }
    .iri {
      overflow-wrap: anywhere;
    }
    [role='alert'] {
      color: #a12622;
    }
    select {
      max-width: 100%;
    }
  `,
})
export class PropertyDetailComponent {
  private readonly client = inject(TerminologyClient);
  readonly hit = input.required<PropertyHit>();
  readonly allowVersions = input(true);
  readonly focused = output<PropertyHit | null>();
  readonly chosen = output<PropertyHit>();
  protected readonly current = signal<PropertyHit>(null!);
  protected readonly hierarchy = signal<PropertyHierarchy | null>(null);
  protected readonly versions = signal<readonly VersionInfo[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly more = signal(false);
  private attempt?: AbortController;

  constructor() {
    effect((onCleanup) => {
      const hit = this.hit();
      const controller = new AbortController();
      this.versions.set([{ id: hit.versionId }]);
      if (this.allowVersions())
        void this.client
          .propertyVersions(hit.sourceAcronym, controller.signal)
          .then((versions) => {
            if (!controller.signal.aborted) this.versions.set(versions.filter((v) => v.propertiesAvailable));
          })
          .catch(() => {
            /* Current release remains usable if the release list is unavailable. */
          });
      void this.read(hit);
      onCleanup(() => {
        controller.abort();
        this.attempt?.abort();
      });
    });
  }

  protected ancestor(iri: string) {
    return this.hierarchy()?.ancestors.find((parent) => parent.iri === iri);
  }
  protected isDescription(predicate: string): boolean {
    return predicate.endsWith('#comment') || predicate.endsWith('#definition') || predicate.endsWith('/IAO_0000115');
  }
  protected navigate(property: Pick<PropertySummary, 'iri' | 'label' | 'kind' | 'obsolete'>): void {
    void this.read({
      ...this.current(),
      termIri: property.iri,
      termLabel: property.label,
      propertyKind: property.kind,
      obsolete: property.obsolete,
    });
  }
  protected changeVersion(event: Event): void {
    void this.read({ ...this.current(), versionId: (event.target as HTMLSelectElement).value });
  }
  protected loadMore(): void {
    void this.read(this.current(), this.hierarchy()?.children.length ?? 0);
  }
  private async read(hit: PropertyHit, offset = 0): Promise<void> {
    this.attempt?.abort();
    const attempt = new AbortController();
    this.attempt = attempt;
    this.current.set(hit);
    this.loading.set(true);
    this.error.set(null);
    this.focused.emit(null);
    if (!offset) this.hierarchy.set(null);
    try {
      const result = await this.client.propertyHierarchy(hit, attempt.signal, offset);
      if (attempt.signal.aborted) return;
      const selected = {
        ...hit,
        termLabel: result.selected.property.label,
        obsolete: result.selected.property.obsolete,
      };
      this.current.set(selected);
      this.hierarchy.update((previous) => ({
        ...result,
        children: [...(offset ? (previous?.children ?? []) : []), ...result.children],
      }));
      this.more.set(result.children.length === 50);
      this.focused.emit(selected);
    } catch (error) {
      if (!attempt.signal.aborted)
        this.error.set(error instanceof Error ? error.message : 'Could not read this property.');
    } finally {
      if (!attempt.signal.aborted) this.loading.set(false);
    }
  }
}
