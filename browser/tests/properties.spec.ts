import { test, expect } from '@playwright/test';
import { stubSearch, results } from './support';

test('property-only table enforces the maximum and browses parents at the selected ontology version', async ({page}) => {
  await stubSearch(page, () => ({sources: [], results: {class: results([])}}));
  const parent = {iri:'urn:related', kind:'object', label:'related to', obsolete:false, parents:[], literals:[]};
  const child = {iri:'urn:part', kind:'object', label:'part of', obsolete:false, parents:['urn:related'], literals:[]};
  await page.route('**/properties/search', route => route.fulfill({json:{total:1,page:1,pageSize:25,items:route.request().postDataJSON().page > 1 ? [] : [{
    sourceAcronym:'RO',versionId:'ro-v2',property:{...child,hasChildren:false},
  }]}}));
  await page.route('**/properties/versions?*', route => route.fulfill({json:[{id:'ro-v2',declaredVersion:'2',propertiesAvailable:true},{id:'ro-v1',declaredVersion:'1',propertiesAvailable:true}]}));
  const seen: string[] = [];
  await page.route('**/properties/hierarchy?*', route => {
    const query = new URL(route.request().url()).searchParams; seen.push(query.get('versionId')!);
    const isParent = query.get('propertyIri') === parent.iri;
    return route.fulfill({json:{selected:{sourceAcronym:'RO',versionId:query.get('versionId'),property:isParent?parent:child},
      ancestors:isParent?[]:[parent],children:isParent?[{...child,hasChildren:false}]:[],offset:0}});
  });
  await page.goto('/');
  await page.locator('cedar-embeddable-term-picker .picker').waitFor();
  await page.locator('cedar-embeddable-term-picker').evaluate(node => {
    const picker = node as HTMLElement & {termTypes:string[];maximumTerms:number};
    picker.termTypes=['property'];picker.maximumTerms=1;
    picker.addEventListener('constraintsSelected', event => { (window as unknown as {saved:unknown}).saved=(event as CustomEvent).detail; });
  });
  const picker = page.locator('cedar-embeddable-term-picker');
  await expect(picker.getByRole('tab')).toHaveCount(1);
  await picker.locator('input[type=search]').fill('part');
  await picker.getByRole('option').filter({hasText:'part of'}).click();
  await expect(picker.getByRole('button',{name:'related to',exact:true})).toBeVisible();
  await picker.getByRole('button',{name:'Select property',exact:true}).click();
  await expect(picker.locator('.constraint-table tbody tr')).toHaveCount(1);
  await picker.getByRole('button',{name:'related to',exact:true}).click();
  await picker.getByRole('button',{name:'Select property',exact:true}).click();
  await expect(picker.getByRole('alert')).toContainText('Remove an entry');
  await picker.getByRole('button',{name:'Remove constraint 1',exact:true}).click();
  await picker.getByLabel('Property ontology release').selectOption('ro-v1');
  await picker.getByRole('button',{name:'Select property',exact:true}).click();
  await picker.getByRole('button',{name:'Done',exact:true}).click();
  expect(await page.evaluate(() => (window as unknown as {saved:unknown}).saved)).toMatchObject({constraints:[{sourceType:'ontology-property',sourceId:'urn:related',version:{id:'ro-v1'}}]});
  expect(seen).toContain('ro-v1');
  await page.screenshot({path:'/tmp/cetp-property-table.png',fullPage:true});
});
