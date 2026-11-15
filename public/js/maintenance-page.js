(() => {
    const pageId = document.body.dataset.maintenancePage;
    if (!pageId) return;

    fetch('/api/maintenance/status')
        .then(response => {
            if (!response.ok) throw new Error(`Maintenance status request failed (${response.status}).`);
            return response.json();
        })
        .then(data => {
            const page = data.pages?.find(item => item.page_id === pageId);
            const leaderboardPage = data.pages?.find(item => item.page_id === 'leaderboard');
            const homeLeaderboardSection = document.getElementById('home-leaderboards');
            if (homeLeaderboardSection) {
                homeLeaderboardSection.hidden = Number(page?.is_offline) === 1 ||
                    Number(leaderboardPage?.is_offline) === 1;
            }
            if (!Number(page?.is_offline)) return;

            const overlay = document.createElement('section');
            overlay.className = 'site-maintenance-overlay';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.setAttribute('aria-labelledby', 'site-maintenance-title');

            const content = document.createElement('div');
            content.className = 'site-maintenance-content';
            const heading = document.createElement('h1');
            heading.id = 'site-maintenance-title';
            heading.textContent = 'Temporarily unavailable';
            const message = document.createElement('p');
            message.textContent = data.outage_message || 'This service is temporarily unavailable while we make updates.';
            content.append(heading, message);
            overlay.append(content);
            document.body.append(overlay);
            heading.focus();
        })
        .catch(error => console.error('Unable to check site maintenance status:', error));
})();
