files = \
    icon128.png \
	manifest.json \
	popup.html \
	popup.js

release-%:
	zip -r release/$*.zip $(files)