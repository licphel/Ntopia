// Available post licenses
const LICENSES = [
  { key: '', name: 'All rights reserved' },
  { key: 'MIT', name: 'MIT' },
  { key: 'CC-BY-4.0', name: 'CC BY 4.0' },
  { key: 'CC-BY-SA-4.0', name: 'CC BY-SA 4.0' },
  { key: 'CC-BY-NC-SA-4.0', name: 'CC BY-NC-SA 4.0' },
  { key: 'CC0-1.0', name: 'CC0 1.0' },
  { key: 'GPL-3.0', name: 'GPL 3.0' },
];

function licenseText(key, opts) {
  const author = (opts && opts.author) || 'The Author';
  const year = (opts && opts.year) || new Date().getFullYear();
  const url = (opts && opts.url) || '';
  const link = url ? '\nOriginal: ' + url + '\n' : '';

  switch (key) {
    case 'MIT':
      return [
        'MIT License',
        '',
        'Copyright (c) ' + year + ' ' + author,
        '',
        'Permission is hereby granted, free of charge, to any person obtaining a copy',
        'of this software and associated documentation files (the "Software"), to deal',
        'in the Software without restriction, including without limitation the rights',
        'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
        'copies of the Software, and to permit persons to whom the Software is',
        'furnished to do so, subject to the following conditions:',
        '',
        'The above copyright notice and this permission notice shall be included in all',
        'copies or substantial portions of the Software.',
        '',
        'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
        'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,',
        'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
        'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER',
        'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,',
        'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE',
        'SOFTWARE.',
        link,
      ].join('\n');
    case 'CC-BY-4.0':
      return 'Licensed under CC BY 4.0 by ' + author + ' — https://creativecommons.org/licenses/by/4.0/' + link;
    case 'CC-BY-SA-4.0':
      return 'Licensed under CC BY-SA 4.0 by ' + author + ' — https://creativecommons.org/licenses/by-sa/4.0/' + link;
    case 'CC-BY-NC-SA-4.0':
      return 'Licensed under CC BY-NC-SA 4.0 by ' + author + ' — https://creativecommons.org/licenses/by-nc-sa/4.0/' + link;
    case 'CC0-1.0':
      return 'Dedicated to the public domain (CC0 1.0) by ' + author + ' — https://creativecommons.org/publicdomain/zero/1.0/' + link;
    case 'GPL-3.0':
      return 'Licensed under GPL 3.0 by ' + author + ' — https://www.gnu.org/licenses/gpl-3.0.html' + link;
    default:
      return 'All rights reserved by ' + author + '.' + link;
  }
}

module.exports = { LICENSES, licenseText };
