(() => {
    const searchInput = document.getElementById('docs-search');
    const clearButton = document.getElementById('docs-clear');
    const resultLabel = document.getElementById('docs-results');
    const content = document.getElementById('docs-content');
    const toc = document.getElementById('docs-toc');
    let docSections = [];

    function normalize(value) {
        return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    }

    function getGroupText(group) {
        return [group.title, ...(group.paragraphs || []), ...(group.items || []),
            ...(group.table ? group.table.headers : []),
            ...(group.table ? group.table.rows.flat() : [])].join(' ');
    }

    function createTextElement(tag, className, value) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        element.textContent = value;
        return element;
    }

    function renderToc(sections) {
        toc.replaceChildren();
        sections.forEach((section, index) => {
            const link = document.createElement('a');
            link.href = `#docs-section-${index}`;
            link.textContent = section.title;
            toc.append(link);
        });
        toc.hidden = sections.length === 0;
    }

    function renderTable(table) {
        const wrapper = document.createElement('div');
        wrapper.className = 'docs-table-wrap';
        const element = document.createElement('table');
        element.className = 'docs-table';
        const head = document.createElement('thead');
        const headRow = document.createElement('tr');
        table.headers.forEach(label => headRow.append(createTextElement('th', '', label)));
        head.append(headRow);
        const body = document.createElement('tbody');
        table.rows.forEach(row => {
            const tableRow = document.createElement('tr');
            row.forEach(value => tableRow.append(createTextElement('td', '', value)));
            body.append(tableRow);
        });
        element.append(head, body);
        wrapper.append(element);
        return wrapper;
    }

    function renderDocs() {
        const terms = normalize(searchInput.value).trim().split(/\s+/).filter(Boolean);
        const matches = [];
        let groupCount = 0;

        docSections.forEach((section, index) => {
            const groups = section.groups.filter(group => {
                const searchableText = normalize(`${section.title} ${section.summary || ''} ${getGroupText(group)}`);
                return terms.every(term => searchableText.includes(term));
            });
            if (groups.length) {
                matches.push({ ...section, index, groups });
                groupCount += groups.length;
            }
        });

        content.replaceChildren();
        clearButton.hidden = !searchInput.value;
        resultLabel.textContent = terms.length
            ? `${groupCount} ${groupCount === 1 ? 'section' : 'sections'} found`
            : `${docSections.length} topics · ${groupCount} sections`;
        renderToc(terms.length ? [] : matches);

        if (!matches.length) {
            content.append(createTextElement('p', 'faq-empty', 'No documentation matches that search. Try different keywords.'));
            return;
        }

        matches.forEach(section => {
            const sectionCard = document.createElement('section');
            sectionCard.className = 'faq-category docs-section';
            sectionCard.id = `docs-section-${section.index}`;
            sectionCard.append(createTextElement('h2', 'docs-section-heading', section.title));
            if (!terms.length && section.summary) sectionCard.append(createTextElement('p', 'docs-section-summary', section.summary));

            section.groups.forEach(group => {
                const groupCard = document.createElement('article');
                groupCard.className = 'docs-group';
                groupCard.append(createTextElement('h3', '', group.title));
                (group.paragraphs || []).forEach(paragraph => groupCard.append(createTextElement('p', '', paragraph)));
                if (group.items?.length) {
                    const list = document.createElement('ul');
                    group.items.forEach(item => list.append(createTextElement('li', '', item)));
                    groupCard.append(list);
                }
                if (group.table) groupCard.append(renderTable(group.table));
                sectionCard.append(groupCard);
            });
            content.append(sectionCard);
        });
    }

    clearButton.addEventListener('click', () => {
        searchInput.value = '';
        searchInput.focus();
        renderDocs();
    });
    searchInput.addEventListener('input', renderDocs);

    fetch('/docs-data.json')
        .then(response => {
            if (!response.ok) throw new Error(`Documentation request failed (${response.status}).`);
            return response.json();
        })
        .then(data => {
            if (!Array.isArray(data) || data.some(section => !section.title || !Array.isArray(section.groups))) {
                throw new Error('Documentation is not in the expected format.');
            }
            docSections = data;
            renderDocs();
        })
        .catch(error => {
            console.error('Unable to load documentation:', error);
            resultLabel.textContent = 'The documentation could not be loaded.';
            content.replaceChildren(createTextElement('p', 'faq-error', 'Documentation is temporarily unavailable. Please refresh the page.'));
            toc.hidden = true;
        });
})();
