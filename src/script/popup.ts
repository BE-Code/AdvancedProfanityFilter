import { dynamicList, escapeHTML } from './lib/helper';
import WebConfig from './webConfig';
import Domain from './domain';

class Popup {
  cfg: WebConfig;
  domain: Domain;
  protected: boolean;
  filterMethodContainer: Element;

  static readonly _disabledPages = new RegExp('(^chrome:|^about:|^[a-zA-Z]*-extension:)', 'i');
  static readonly _requiredConfig =  [
    'advancedDomains',
    'audioWordlistId',
    'disabledDomains',
    'enabledDomains',
    'enabledDomainsOnly',
    'filterMethod',
    'muteAudio',
    'password',
    'wordlists',
    'wordlistsEnabled',
    'wordlistId'
  ];

  static async load(instance: Popup) {
    instance.cfg = await WebConfig.build(Popup._requiredConfig);
    instance.domain = new Domain();
    await instance.domain.load();
    return instance;
  }

  constructor() {
    this.protected = false;
    this.filterMethodContainer = document.getElementById('filterMethodContainer');
  }

  ////
  // Functions for Popup
  static disable(element) {
    element.disabled = true;
    element.classList.add('disabled');
  }

  static enable(element) {
    element.disabled = false;
    element.classList.remove('disabled');
  }

  static hide(element: HTMLElement) {
    element.classList.remove('w3-show');
    element.classList.add('w3-hide');
  }

  static show(element: HTMLElement) {
    element.classList.remove('w3-hide');
    element.classList.add('w3-show');
  }

  async addDomain(key: string) {
    let popup = this;
    if (!popup.cfg[key].includes(popup.domain.hostname)) {
      popup.cfg[key].push(popup.domain.hostname);
      let error = await popup.cfg.save(key);
      if (!error) {
        switch(key) {
          case 'enabledDomains':
            Popup.enable(document.getElementById('advancedMode'));
            Popup.enable(document.getElementById('filterMethodSelect'));
            break;
          case 'disabledDomains':
            Popup.disable(document.getElementById('advancedMode'));
            Popup.disable(document.getElementById('filterMethodSelect'));
            break;
        }
        chrome.tabs.reload();
      }
    }
  }

  async filterMethodSelect() {
    let filterMethodSelect = document.getElementById('filterMethodSelect') as HTMLSelectElement;
    popup.cfg.filterMethod = filterMethodSelect.selectedIndex;
    let error = await popup.cfg.save('filterMethod');
    if (!error) {
      chrome.tabs.reload();
    }
  }

  async populateOptions(event?: Event) {
    let popup = this;
    await Popup.load(popup);

    let domainFilter = document.getElementById('domainFilter') as HTMLInputElement;
    let domainToggle = document.getElementById('domainToggle') as HTMLInputElement;
    let advancedMode = document.getElementById('advancedMode') as HTMLInputElement;
    let filterMethodSelect = document.getElementById('filterMethodSelect') as HTMLSelectElement;
    let wordListContainer = document.getElementById('wordListContainer') as HTMLInputElement;
    let wordlistSelect = document.getElementById('wordlistSelect') as HTMLSelectElement;
    let audioWordlistSelect = document.getElementById('audioWordlistSelect') as HTMLSelectElement;
    dynamicList(WebConfig._filterMethodNames, 'filterMethodSelect');
    filterMethodSelect.selectedIndex = popup.cfg.filterMethod;

    if (popup.cfg.wordlistsEnabled) {
      dynamicList(WebConfig._allWordlists.concat(popup.cfg.wordlists), wordlistSelect.id);
      wordlistSelect.selectedIndex = popup.cfg.wordlistId;
      if (popup.cfg.muteAudio) {
        dynamicList(WebConfig._allWordlists.concat(popup.cfg.wordlists), audioWordlistSelect.id);
        audioWordlistSelect.selectedIndex = popup.cfg.audioWordlistId;
        let audioWordlistContainer = document.getElementById('audioWordlistContainer') as HTMLElement;
        Popup.show(audioWordlistContainer);
      }
      Popup.show(wordListContainer);
    }

    if (popup.cfg.password && popup.cfg.password != '') {
      popup.protected = true;
      Popup.disable(domainFilter);
      Popup.disable(domainToggle);
      Popup.disable(advancedMode);
      Popup.disable(filterMethodSelect);
      Popup.disable(wordlistSelect);
      Popup.disable(audioWordlistSelect);
    }

    // Restricted pages
    if (Popup._disabledPages.test(popup.domain.url.protocol) || popup.domain.hostname == 'chrome.google.com') {
      domainFilter.checked = false;
      Popup.disable(domainFilter);
      Popup.disable(domainToggle);
      Popup.disable(advancedMode);
      Popup.disable(filterMethodSelect);
      Popup.disable(wordlistSelect);
      Popup.disable(audioWordlistSelect);
      return false;
    }

    // Set initial value for domain filter and disable options if they are not applicable
    if (
      (
        popup.cfg.enabledDomainsOnly
        && !Domain.domainMatch(popup.domain.hostname, popup.cfg.enabledDomains)
      )
      || Domain.domainMatch(popup.domain.hostname, popup.cfg.disabledDomains)
    ) {
      domainFilter.checked = false;
      Popup.disable(advancedMode);
      Popup.disable(filterMethodSelect);
      Popup.disable(wordlistSelect);
      Popup.disable(audioWordlistSelect);
    }

    // Set initial value for advanced mode
    if (Domain.domainMatch(popup.domain.hostname, popup.cfg['advancedDomains'])) {
      advancedMode.checked = true;
    }
  }

  populateSummary(message: Message) {
    if (message && message.summary) {
      let summaryEl = document.getElementById('summary') as HTMLElement;
      summaryEl.innerHTML = this.summaryTableHTML(message.summary);

      if (summaryEl.classList.contains('w3-hide')) {
        summaryEl.classList.remove('w3-hide');
        summaryEl.classList.add('w3-show');
        document.getElementById('summaryDivider').classList.remove('w3-hide');
      }
    } else {
      // console.log('Unahndled message: ', message); // DEBUG
    }
  }

  async removeDomain(key: string) {
    let popup = this;
    let newDomainList = Domain.removeFromList(popup.domain.hostname, popup.cfg[key]);

    if (newDomainList.length < popup.cfg[key].length) {
      popup.cfg[key] = newDomainList;
      let error = await popup.cfg.save(key);
      if (!error) {
        switch(key) {
          case 'enabledDomains':
            Popup.disable(document.getElementById('advancedMode'));
            Popup.disable(document.getElementById('filterMethodSelect'));
            break;
          case 'disabledDomains':
            Popup.enable(document.getElementById('advancedMode'));
            Popup.enable(document.getElementById('filterMethodSelect'));
            break;
        }
        chrome.tabs.reload();
      }
    }
  }

  summaryTableHTML(summary: Summary): string {
    let tableInnerHTML = '';
    if (Object.keys(summary).length > 0) {
      tableInnerHTML = '<table class="w3-table w3-striped w3-border w3-bordered w3-card w3-small"><tr class="w3-flat-peter-river"><th colspan="2" class="w3-center">Filtered Words</th></tr>';
      Object.keys(summary).sort((a,b) => summary[b].count - summary[a].count).forEach(key => {
        tableInnerHTML += `<tr><td class="w3-tooltip"><span style="position:absolute;left:0;bottom:18px" class="w3-text w3-tag">${escapeHTML(key)}</span>${escapeHTML(summary[key].filtered)}</td><td class="w3-right">${summary[key].count}</td></tr>`;
      });
      tableInnerHTML += '</table>';
    }

    return tableInnerHTML;
  }

  toggleAdvancedMode() {
    let popup = this;
    if (!popup.protected) {
      let advancedMode = document.getElementById('advancedMode') as HTMLInputElement;
      advancedMode.checked ? popup.addDomain('advancedDomains') : popup.removeDomain('advancedDomains');
    }
  }

  toggleFilter() {
    let popup = this;
    if (!popup.protected) {
      let domainFilter = document.getElementById('domainFilter') as HTMLInputElement;
      if (popup.cfg.enabledDomainsOnly) {
        domainFilter.checked ? popup.addDomain('enabledDomains') : popup.removeDomain('enabledDomains');
      } else {
        domainFilter.checked ? popup.removeDomain('disabledDomains') : popup.addDomain('disabledDomains');
      }
    }
  }

  async wordlistSelect(event) {
    let element = event.target;
    let type = element.id === 'wordlistSelect' ? 'wordlistId' : 'audioWordlistId';
    popup.cfg[type] = element.selectedIndex;
    if (!await popup.cfg.save(type)) {
      chrome.tabs.reload();
    }
  }
}

// Listen for data updates from filter
chrome.runtime.onMessage.addListener((request: Message, sender, sendResponse) => {
  if (request.summary) {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (sender.tab.id == tabs[0].id) popup.populateSummary(request);
    });
  }
});

// Initial data request
chrome.tabs.query({active: true, currentWindow: true}, tabs => {
  chrome.tabs.sendMessage(tabs[0].id, {popup: true});
});

let popup = new Popup;

////
// Listeners
window.addEventListener('load', function(event) { popup.populateOptions(); });
document.getElementById('domainFilter').addEventListener('change', function(event) { popup.toggleFilter(); });
document.getElementById('advancedMode').addEventListener('change', function(event) { popup.toggleAdvancedMode(); });
document.getElementById('filterMethodSelect').addEventListener('change', function(event) { popup.filterMethodSelect(); });
document.getElementById('wordlistSelect').addEventListener('change', function(event) { popup.wordlistSelect(event); });
document.getElementById('audioWordlistSelect').addEventListener('change', function(event) { popup.wordlistSelect(event); });
document.getElementById('options').addEventListener('click', function() { chrome.runtime.openOptionsPage(); });