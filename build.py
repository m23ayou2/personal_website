import html
from datetime import date

from pybtex.database.input import bibtex

MY_NAME = 'Mohammed-El-Houcine Ayoubi'


def get_personal_data():
    name = ['Houcine', 'Ayoubi']
    description = 'Engineering student at IMT Atlantique, interested in applied mathematics and high-performance computing.'
    # Small line shown above the intro, with a blinking cursor after it.
    motto = 'measure twice,<br>vectorize once'
    bio_text = """
        <h1>Hi, I’m Houcine.</h1>
        <p>Engineering student @ <a href="https://www.imt-atlantique.fr/en" target="_blank" rel="noopener noreferrer">IMT Atlantique</a>, with a deep interest in applied mathematics and high-performance computing.</p>
        <p>I’m actively seeking engineering opportunities: internships, full-time roles and collaborations.</p>
        <p class="links"><a href="mailto:ayoubimohammedelhoucine@gmail.com">mail</a><span class="sep"> / </span><a href="https://scholar.google.com/citations?user=-7CHMbkAAAAJ&amp;hl=fr" target="_blank" rel="noopener noreferrer">scholar</a><span class="sep"> / </span><a href="https://github.com/m23ayou2" target="_blank" rel="noopener noreferrer">github</a><span class="sep"> / </span><a href="https://www.linkedin.com/in/mohammed-el-houcine-ayoubi" target="_blank" rel="noopener noreferrer">linkedin</a></p>
    """
    return name, description, motto, bio_text


def get_author_dict():
    return {
        'Mathieu Leonardon': 'https://www.mathieuleonardon.com/',
        'Adrien Cassagne': 'https://largo.lip6.fr/~cassagnea/',
        'Romain Tajan': 'https://rtajan.github.io/teaching/',
        'Camille Leroux': 'https://scholar.google.com/citations?user=EBYOGZAAAAAJ&hl=en',
    }


def person_name(p):
    return ' '.join(p.get_part('first') + p.get_part('last'))


def generate_person_html(persons, connection=', ', make_bold_name=MY_NAME, add_links=True):
    links = get_author_dict() if add_links else {}
    parts = []
    for p in persons:
        name = person_name(p)
        if name == make_bold_name:
            parts.append(f'<span class="me">{html.escape(name)}</span>')
        elif name in links:
            parts.append(f'<a href="{html.escape(links[name])}" target="_blank" rel="noopener noreferrer">{html.escape(name)}</a>')
        else:
            parts.append(html.escape(name))
    return connection.join(parts)


def get_artefact_links(fields, artefacts):
    links, seen = [], set()
    for (k, v) in artefacts.items():
        if k in fields and fields[k] not in seen:
            seen.add(fields[k])
            links.append(f'<a href="{html.escape(fields[k])}" target="_blank" rel="noopener noreferrer">{v}</a>')
    return links


def get_bibtex(entry_key, entry):
    authors = ' and '.join(person_name(p) for p in entry.persons['author'])
    cite = '@InProceedings{' + f'{entry_key},\n'
    cite += '  author = {' + authors + '},\n'
    for field in ['title', 'booktitle', 'year']:
        cite += f'  {field} = ' + '{' + entry.fields[field] + '},\n'
    cite += '}'
    return html.escape(cite)


def get_paper_entry(entry_key, entry, with_bibtex=True):
    fields = entry.fields
    main_link = fields.get('html') or fields.get('pdf')

    s = f'<li class="entry" id="{entry_key}">'
    if 'img' in fields:
        s += f'<a class="thumb" href="{html.escape(main_link)}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true">'
        s += f'<img src="{fields["img"]}" alt="" loading="lazy"></a>'
    s += '<div>'

    title = html.escape(fields['title'])
    if main_link:
        title = f'<a href="{html.escape(main_link)}" target="_blank" rel="noopener noreferrer">{title}</a>'
    if 'award' in fields:
        title += f' <span class="award">({html.escape(fields["award"])})</span>'
    s += f'<h3>{title}</h3>'
    s += f'<p class="authors">{generate_person_html(entry.persons["author"])}</p>'
    s += f'<p class="venue"><em>{html.escape(fields["booktitle"])}</em>, {fields["year"]}</p>'

    artefacts = {'html': 'project page', 'pdf': 'paper', 'supp': 'supplemental', 'video': 'video', 'poster': 'poster', 'code': 'code'}
    links = get_artefact_links(fields, artefacts)
    if with_bibtex:
        links.append(f'<button class="link-button" type="button" data-bib aria-expanded="false" aria-controls="bib-{entry_key}">bibtex</button>')
    s += '<p class="artefacts">' + '<span class="sep"> / </span>'.join(links) + '</p>'
    if with_bibtex:
        s += f'<div class="bib" id="bib-{entry_key}" hidden><button class="copy" type="button">copy</button><pre>{get_bibtex(entry_key, entry)}</pre></div>'
    s += '</div></li>'
    return s


def get_talk_entry(entry_key, entry):
    fields = entry.fields
    s = f'<li class="entry" id="{entry_key}">'
    if 'img' in fields:
        s += f'<span class="thumb"><img src="{fields["img"]}" alt="" loading="lazy"></span>'
    s += '<div>'
    s += f'<h3>{html.escape(fields["title"])}</h3>'
    s += f'<p class="venue"><em>{html.escape(fields["booktitle"])}</em>, {fields["year"]}</p>'
    links = get_artefact_links(fields, {'slides': 'slides', 'video': 'recording'})
    if links:
        s += '<p class="artefacts">' + '<span class="sep"> / </span>'.join(links) + '</p>'
    s += '</div></li>'
    return s


def parse_bib(filename):
    return bibtex.Parser().parse_file(filename).entries


def get_section_html(title, entries):
    if not entries:
        return ''
    return f"""
      <section class="section">
        <h2><span>{title}</span><span>{len(entries):02d}</span></h2>
        <ol class="entries">{''.join(entries)}</ol>
      </section>"""


NAV_ITEMS = [('home', './'), ('blog', 'blog.html')]

THEME_ICONS = """<svg class="icon-moon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 9.6A5.6 5.6 0 0 1 6.4 2.5a5.6 5.6 0 1 0 7.1 7.1z"/></svg><svg class="icon-sun" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="2.8"/><path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M3.2 12.8l1.1-1.1M11.7 4.3l1.1-1.1"/></svg>"""

# Runs before first paint so a saved theme never flashes the wrong colours.
THEME_INIT = """<script>try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>"""


def get_page_html(title, description, active, body, scripts=()):
    nav = ''
    for (label, href) in NAV_ITEMS:
        current = ' aria-current="page"' if label == active else ''
        nav += f'<a href="{href}"{current}>{label}</a>'
    script_tags = ''.join(f'<script src="assets/js/{s}" defer></script>' for s in scripts)
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <meta name="description" content="{description}">
  <meta property="og:title" content="{title}">
  <meta property="og:description" content="{description}">
  <meta property="og:type" content="website">
  <link rel="icon" type="image/x-icon" href="assets/favicon.ico">
  {THEME_INIT}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600&display=swap">
  <link rel="stylesheet" href="assets/css/style.css">
  {script_tags}
</head>
<body>
  <nav class="nav" aria-label="Main" data-dim>
    {nav}
    <button class="theme-toggle" type="button" aria-label="Toggle dark mode">{THEME_ICONS}</button>
  </nav>
{body}
</body>
</html>
"""


CREDIT = 'design inspired by <a href="https://www.daoho.dev/" target="_blank" rel="noopener noreferrer">Dao Ho</a>'


def get_index_html():
    name, description, motto, bio_text = get_personal_data()
    body = f"""  <canvas id="pond" aria-hidden="true"></canvas>
  <main class="hero">
    <blockquote class="motto reveal" data-avoid>{motto}<span class="cursor" aria-hidden="true"></span></blockquote>
    <div class="intro reveal" style="--i: 1" data-avoid>{bio_text}</div>
    <p class="credit reveal" style="--i: 2" data-avoid>{CREDIT}</p>
  </main>"""
    return get_page_html(f'{name[0]} {name[1]}', description, 'home', body, scripts=['site.js', 'pond.js'])


def get_blog_html():
    name, description, _, _ = get_personal_data()
    pubs = [get_paper_entry(k, e) for (k, e) in parse_bib('publication_list.bib').items()]
    projects = [get_paper_entry(k, e, with_bibtex=False) for (k, e) in parse_bib('project_list.bib').items()]
    talks = [get_talk_entry(k, e) for (k, e) in parse_bib('talk_list.bib').items()]
    body = f"""  <main class="page">
    <header class="page-head reveal">
      <h1>blog</h1>
      <p>Publications and projects, newest first.</p>
    </header>
    <div class="reveal" style="--i: 1">
      {get_section_html('publications', pubs)}
      {get_section_html('projects', projects)}
      {get_section_html('talks', talks)}
    </div>
  </main>
  <footer class="site-footer">© {date.today().year} {name[0]} {name[1]}<span class="sep"> · </span>{CREDIT}</footer>"""
    return get_page_html(f'Blog · {name[0]} {name[1]}', description, 'blog', body, scripts=['site.js'])


def write_file(filename, s):
    with open(filename, 'w') as f:
        f.write(s)
    print(f'Written content to {filename}.')


if __name__ == '__main__':
    write_file('index.html', get_index_html())
    write_file('blog.html', get_blog_html())
