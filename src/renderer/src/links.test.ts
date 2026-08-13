import { describe, expect, it } from 'vitest'
import { extractLinksFromHtml, hostLabel, normalizeUrl } from './links'

describe('normalizeUrl', () => {
  it('adds https:// to scheme-less pastes, leaves real schemes alone', () => {
    expect(normalizeUrl('acme.slack.com/archives/C1')).toBe('https://acme.slack.com/archives/C1')
    expect(normalizeUrl('https://docs.google.com/d/x')).toBe('https://docs.google.com/d/x')
    expect(normalizeUrl('mailto:a@b.com')).toBe('mailto:a@b.com')
  })
})

describe('hostLabel', () => {
  it('names a link by hostname, minus www', () => {
    expect(hostLabel('https://www.notion.so/page')).toBe('notion.so')
    expect(hostLabel('https://docs.google.com/document/d/abc')).toBe('docs.google.com')
    expect(hostLabel('not a url')).toBe('not a url')
  })
})

describe('extractLinksFromHtml (notes → derived links)', () => {
  it('finds anchors, naming them by their text', () => {
    const html = '<p>see <a target="_blank" href="https://a.com/x">the doc</a> and ' +
      '<a href="https://b.com/y">notes</a></p>'
    expect(extractLinksFromHtml(html)).toEqual([
      { title: 'the doc', url: 'https://a.com/x' },
      { title: 'notes', url: 'https://b.com/y' }
    ])
  })

  it('a bare pasted URL is named by its hostname, not repeated', () => {
    const html = '<p><a href="https://acme.slack.com/archives/C1">https://acme.slack.com/archives/C1</a></p>'
    expect(extractLinksFromHtml(html)).toEqual([
      { title: 'acme.slack.com', url: 'https://acme.slack.com/archives/C1' }
    ])
  })

  it('dedupes by url, decodes entities, strips nested tags, skips non-http', () => {
    const html =
      '<a href="https://a.com/?x=1&amp;y=2"><b>bold</b> name</a>' +
      '<a href="https://a.com/?x=1&amp;y=2">again</a>' +
      '<a href="mailto:x@y.com">mail</a>'
    expect(extractLinksFromHtml(html)).toEqual([
      { title: 'bold name', url: 'https://a.com/?x=1&y=2' }
    ])
  })

  it('empty or link-free notes derive nothing', () => {
    expect(extractLinksFromHtml('')).toEqual([])
    expect(extractLinksFromHtml('<p>plain text</p>')).toEqual([])
  })
})
