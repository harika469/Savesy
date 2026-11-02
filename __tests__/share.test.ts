import { shareToSaveParams } from '@/utils/share';

describe('shareToSaveParams', () => {
  it('uses the web url and title from the sharing app', () => {
    expect(shareToSaveParams({ webUrl: 'https://youtu.be/abc', text: 'https://youtu.be/abc', meta: { title: 'Pasta 101' } }))
      .toEqual({ url: 'https://youtu.be/abc', sharedTitle: 'Pasta 101', sharedNote: undefined });
  });
  it('pulls the link out of shared text and keeps the rest as a note', () => {
    expect(shareToSaveParams({ text: 'You need this lamp https://shop.com/lamp so cute' }))
      .toEqual({ url: 'https://shop.com/lamp', sharedTitle: undefined, sharedNote: 'You need this lamp so cute' });
  });
  it('does not repeat the title as the note', () => {
    expect(shareToSaveParams({ text: 'Big News https://news.com/a', meta: { title: 'Big News' } })?.sharedNote).toBeUndefined();
  });
  it('keeps plain text with no link as a note', () => expect(shareToSaveParams({ text: 'a recipe idea' })).toEqual({ url: undefined, sharedTitle: undefined, sharedNote: 'a recipe idea' }));
  it('ignores empty shares', () => expect(shareToSaveParams({ text: '  ', webUrl: null })).toBeUndefined());
});
