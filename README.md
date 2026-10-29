# Personal Website

Source of my homepage. It is plain HTML, CSS and JavaScript (no framework, no build step on the server), so GitHub Pages serves it straight from this repository.

- `index.html`: home page, with an ASCII koi pond in the background (`assets/js/pond.js`); click the water to feed the koi
- `work.html`: publications, projects and talks, generated from the `.bib` files
- `assets/css/style.css`: all styling, including the light and dark themes
- `assets/js/site.js`: theme toggle and BibTeX show/copy buttons

## How to update it
1. Edit the name, intro text, motto and links in `get_personal_data` in `build.py`.
2. Add entries to `publication_list.bib`, `project_list.bib` or `talk_list.bib`. Entries are shown top to bottom, so put the newest first. Optional fields `html`, `pdf`, `code`, `video`, `supp`, `poster` and `award` add links or a badge; `img` sets the thumbnail.
3. Add co-author websites to `get_author_dict` in `build.py` to link their names.
4. Run `pip install pybtex` once, then `python build.py` to regenerate `index.html` and `work.html`.
5. Preview locally with `python -m http.server` and open http://localhost:8000, then commit and push.

## Credits

The `build.py` + BibTeX approach comes from [Michael Niemeyer's website template](https://m-niemeyer.github.io/), itself inspired by [Jon Barron's](https://jonbarron.info/). The design and the ASCII koi pond are inspired by [Dao Ho's website](https://www.daoho.dev/), credited at the bottom of each page.
