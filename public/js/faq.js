(() => {
    const searchInput = document.getElementById('faq-search');
    const clearButton = document.getElementById('faq-clear');
    const resultLabel = document.getElementById('faq-results');
    const content = document.getElementById('faq-content');
    let faqSections = [];

    function normalize(value) {
        return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    }

    function formatAnswer(value) {
        return value
            .replace(/:(Daily Loss Limit|Maximum Drawdown|Crypto Pairs|Forex Majors|Indices & Commodities|Mid Price|Mark Price|Latency arbitrage)/g, ':\n$1')
            .replace(/\.(Exploiting platform\/feed latency|Account sharing|Reverse arbitrage|Hard refresh|Clear your browser)/g, '.\n$1');
    }

    function renderFaq() {
        const terms = normalize(searchInput.value).trim().split(/\s+/).filter(Boolean);
        const matchingSections = [];
        let totalMatches = 0;

        faqSections.forEach(section => {
            const items = section.items.filter(item => {
                const searchableText = normalize(`${section.title} ${item.question} ${item.answer}`);
                return terms.every(term => searchableText.includes(term));
            });
            if (items.length) {
                matchingSections.push({ title: section.title, items });
                totalMatches += items.length;
            }
        });

        content.replaceChildren();
        clearButton.hidden = !searchInput.value;
        resultLabel.textContent = terms.length
            ? `${totalMatches} ${totalMatches === 1 ? 'answer' : 'answers'} found`
            : `${totalMatches} answers across ${matchingSections.length} topics`;

        if (!matchingSections.length) {
            const emptyMessage = document.createElement('p');
            emptyMessage.className = 'faq-empty';
            emptyMessage.textContent = 'No answers match that search. Try different keywords.';
            content.append(emptyMessage);
            return;
        }

        matchingSections.forEach(section => {
            const category = document.createElement('section');
            category.className = 'faq-category';
            const heading = document.createElement('h2');
            heading.textContent = section.title;
            category.append(heading);

            section.items.forEach(item => {
                const details = document.createElement('details');
                details.className = 'faq-item';
                details.open = terms.length > 0;
                const question = document.createElement('summary');
                question.textContent = item.question;
                const answer = document.createElement('p');
                answer.className = 'faq-answer';
                answer.textContent = formatAnswer(item.answer);
                details.append(question, answer);
                category.append(details);
            });

            content.append(category);
        });
    }

    clearButton.addEventListener('click', () => {
        searchInput.value = '';
        searchInput.focus();
        renderFaq();
    });

    searchInput.addEventListener('input', renderFaq);

    fetch('/faq-data.json')
        .then(response => {
            if (!response.ok) throw new Error(`FAQ data request failed (${response.status}).`);
            return response.json();
        })
        .then(data => {
            if (!Array.isArray(data) || data.some(section => !section.title || !Array.isArray(section.items))) {
                throw new Error('FAQ data is not in the expected format.');
            }
            faqSections = data;
            renderFaq();
        })
        .catch(error => {
            console.error('Unable to load FAQ data:', error);
            resultLabel.textContent = 'The FAQ could not be loaded.';
            content.replaceChildren();
            const errorMessage = document.createElement('p');
            errorMessage.className = 'faq-error';
            errorMessage.textContent = 'Answers are temporarily unavailable. Please refresh the page or contact support@blastrr.com.';
            content.append(errorMessage);
        });
})();
