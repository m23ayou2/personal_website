# Personal Website

Source of my homepage. It is plain HTML, CSS and JavaScript (no framework, no build step on the server), so GitHub Pages serves it straight from this repository.

- `index.html`: home page, with a superbike race drawn in ASCII in the background (`assets/js/race.js`, playing `assets/video/race.mp4`); move the mouse over it to light it up
- `blog.html`: publications, projects and talks, generated from the `.bib` files
- `assets/css/style.css`: all styling, including the light and dark themes
- `assets/js/site.js`: theme toggle and BibTeX show/copy buttons

## How to update it
1. Edit the name, intro text and links in `get_personal_data` in `build.py`.
2. Add entries to `publication_list.bib`, `project_list.bib` or `talk_list.bib`. Entries are shown top to bottom, so put the newest first. Optional fields `html`, `pdf`, `code`, `video`, `supp`, `poster` and `award` add links or a badge; `img` sets the thumbnail.
3. Add co-author websites to `get_author_dict` in `build.py` to link their names.
4. Run `pip install pybtex` once, then `python build.py` to regenerate `index.html` and `blog.html`.
5. Preview locally with `python -m http.server` and open http://localhost:8000, then commit and push.

## Credits

The `build.py` + BibTeX approach comes from [Michael Niemeyer's website template](https://m-niemeyer.github.io/), itself inspired by [Jon Barron's](https://jonbarron.info/). The design is inspired by [Dao Ho's website](https://www.daoho.dev/), and the ASCII video background by the racing header on [General Intuition's website](https://www.generalintuition.com/); both are credited at the bottom of each page. The race footage is [a clip by Harvey Tan Villarino on Pexels](https://www.pexels.com/video/high-speed-motorcycle-racing-on-track-30396996/), used under the Pexels license and re-encoded at 30 fps.
