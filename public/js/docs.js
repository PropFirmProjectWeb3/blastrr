(() => {
    const searchInput = document.getElementById('docs-search');
    const clearButton = document.getElementById('docs-clear');
    const resultLabel = document.getElementById('docs-results');
    const content = document.getElementById('docs-content');
    const nav = document.getElementById('docs-nav');
    let docPages = [];
    let currentPageId = '';

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

    function renderNav(pages, searchActive) {
        nav.replaceChildren();
        pages.forEach(page => {
            const link = document.createElement('a');
            link.href = `#${page.id}`;
            link.className = 'docs-nav-link';
            link.dataset.docId = page.id;
            link.setAttribute('aria-current', !searchActive && page.id === currentPageId ? 'page' : 'false');
            link.append(createTextElement('span', '', page.title));
            if (searchActive) link.append(createTextElement('small', 'docs-nav-count', String(page.groups.length)));
            nav.append(link);
        });
        nav.hidden = pages.length === 0;
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

    function renderGroup(group) {
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
        return groupCard;
    }

    function renderDocs() {
        const terms = normalize(searchInput.value).trim().split(/\s+/).filter(Boolean);
        const searchActive = terms.length > 0;
        const matchingPages = docPages.map(page => ({
            ...page,
            groups: page.groups.filter(group => {
                const searchableText = normalize(`${page.title} ${page.summary || ''} ${getGroupText(group)}`);
                return terms.every(term => searchableText.includes(term));
            })
        })).filter(page => page.groups.length > 0);
        const visiblePages = searchActive
            ? matchingPages
            : docPages.filter(page => page.id === currentPageId);
        const matchingGroupCount = matchingPages.reduce((count, page) => count + page.groups.length, 0);

        content.replaceChildren();
        clearButton.hidden = !searchInput.value;
        resultLabel.textContent = searchActive
            ? `${matchingGroupCount} ${matchingGroupCount === 1 ? 'section' : 'sections'} found in ${matchingPages.length} ${matchingPages.length === 1 ? 'page' : 'pages'}`
            : `${visiblePages[0]?.groups.length || 0} sections on this page · ${docPages.length} documentation pages`;
        renderNav(searchActive ? matchingPages : docPages, searchActive);

        if (!visiblePages.length) {
            content.append(createTextElement('p', 'faq-empty', 'No documentation matches that search. Try different keywords.'));
            return;
        }

        visiblePages.forEach(page => {
            const pageCard = document.createElement('section');
            pageCard.className = 'faq-category docs-page';
            pageCard.id = `docs-page-${page.id}`;
            pageCard.append(createTextElement('h2', 'docs-section-heading', page.title));
            if (!searchActive && page.summary) pageCard.append(createTextElement('p', 'docs-section-summary', page.summary));
            page.groups.forEach(group => pageCard.append(renderGroup(group)));
            content.append(pageCard);
        });
    }

    nav.addEventListener('click', event => {
        const link = event.target.closest('a[data-doc-id]');
        if (!link) return;
        currentPageId = link.dataset.docId;
        if (searchInput.value) searchInput.value = '';
        renderDocs();
    });
    window.addEventListener('hashchange', () => {
        const pageId = window.location.hash.slice(1);
        if (docPages.some(page => page.id === pageId)) {
            currentPageId = pageId;
            searchInput.value = '';
            renderDocs();
        }
    });

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
            if (!Array.isArray(data) || data.some(page =>
                !page.id || !page.title || !Array.isArray(page.groups) ||
                page.groups.some(group => !group.title)
            )) {
                throw new Error('Documentation is not in the expected format.');
            }
            docPages = data;
            const requestedPageId = decodeURIComponent(window.location.hash.slice(1));
            currentPageId = docPages.some(page => page.id === requestedPageId)
                ? requestedPageId
                : docPages[0]?.id || '';
            renderDocs();
        })
        .catch(error => {
            console.error('Unable to load documentation:', error);
            resultLabel.textContent = 'The documentation could not be loaded.';
            content.replaceChildren(createTextElement('p', 'faq-error', 'Documentation is temporarily unavailable. Please refresh the page.'));
            nav.hidden = true;
        });
})();
