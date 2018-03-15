# ditherer

[![Build Status](https://travis-ci.org/gyng/ditherer.svg?branch=master)](https://travis-ci.org/gyng/ditherer)

![screenshot](screenshot.png)

For all your online dithering needs.

* Dithering algorithms (Ordered, error-diffusing, and more)
* Video support
* Video recording support
* Colour palette
* Adaptive colour palette
* Palette extraction
* Pixel sorting
* (Real) glitching
* Convolve
* CRT emulation
* Brightness/contrast
* Bunch more other filters and features

#### TODO

* Cleanup (especially how realtime filtering is handled)
* More filters
* Better UI/UX

#### Deploying

```
NODE_ENV=production  yarn deploy
```

or

```
NODE_ENV=production yarn build:prod
yarn deploy:prebuilt
```

or

```
NODE_ENV=production  yarn build:prod
git checkout gh-pages
rm commons.js index.html app.*.js
mv build/* .
git add .
git commit
git push origin gh-pages
```

#### References

1. http://www.efg2.com/Lab/Library/ImageProcessing/DHALF.TXT
2. http://www.tannerhelland.com/4660/dithering-eleven-algorithms-source-code/
3. http://www.easyrgb.com/en/math.php#text8
