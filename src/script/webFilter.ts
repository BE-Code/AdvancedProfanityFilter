import Constants from './lib/constants';
import Domain from './domain';
import Filter from './lib/filter';
import Page from './page';
import WebAudio from './webAudio';
import WebConfig from './webConfig';
import Wordlist from './lib/wordlist';
import './vendor/findAndReplaceDOMText';

export default class WebFilter extends Filter {
  audio: WebAudio;
  audioOnly: boolean;
  audioWordlistId: number;
  cfg: WebConfig;
  domain: Domain;
  hostname: string;
  iframe: Location;
  location: Location | URL;
  mutePage: boolean;
  observer: MutationObserver;
  processMutationTarget: boolean;
  processNode: Function;
  shadowObserver: MutationObserver;
  summary: Summary;

  constructor() {
    super();
    this.audioWordlistId = 0;
    this.mutePage = false;
    this.processMutationTarget = false;
    this.summary = {};
  }

  advancedReplaceText(node, wordlistId: number, stats = true) {
    if (node.parentNode || node === document) {
      filter.wordlists[wordlistId].regExps.forEach((regExp) => {
        // @ts-ignore - External library function
        findAndReplaceDOMText(node, { preset: 'prose', find: regExp, replace: function(portion, match) {
          // console.log('[APF] Advanced node match:', node.textContent); // Debug: Filter - Advanced match
          if (portion.index === 0) { // Replace the whole match on the first portion and skip the rest
            return filter.replaceText(match[0], wordlistId, stats);
          } else {
            return '';
          }
        } });
      });
    } else {
      // ?: Might want to add support for processNode()
      this.cleanText(node, wordlistId, stats);
    }
  }

  checkMutationForProfanity(mutation) {
    // console.count('[APF] filter.checkMutationForProfanity() count'); // Benchmark: Filter
    // console.log('[APF] Mutation observed:', mutation); // Debug: Filter - Mutation
    mutation.addedNodes.forEach(node => {
      if (!Page.isForbiddenNode(node)) {
        // console.log('[APF] Added node(s):', node); // Debug: Filter - Mutation addedNodes
        if (filter.mutePage) {
          filter.cleanAudio(node);
        } else if (!filter.audioOnly) {
          filter.processNode(node, filter.wordlistId);
        }
      }
      // else { console.log('[APF] Forbidden node:', node); } // Debug: Filter - Mutation addedNodes
    });

    // Check removed nodes to see if we should unmute
    if (filter.mutePage && filter.audio.muted) {
      mutation.removedNodes.forEach(node => {
        let supported = filter.audio.supportedNode(node);
        let rule = supported !== false ? filter.audio.rules[supported] : filter.audio.rules[0]; // Use the matched rule, or the first rule
        if (
          supported !== false
          || node == filter.audio.lastFilteredNode
          || node.contains(filter.audio.lastFilteredNode)
          || (
            rule.simpleUnmute
            && filter.audio.lastFilteredText
            && filter.audio.lastFilteredText.includes(node.textContent)
          )
        ) {
          filter.audio.unmute(rule);
        }
      });
    }

    if (mutation.target) {
      if (mutation.target.nodeName === '#text') {
        filter.checkMutationTargetTextForProfanity(mutation);
      } else if (filter.processMutationTarget) {
        filter.processNode(mutation.target, filter.wordlistId);
      }
    }
  }

  checkMutationTargetTextForProfanity(mutation) {
    // console.count('checkMutationTargetTextForProfanity'); // Benchmark: Filter
    // console.log('[APF] Process mutation.target:', mutation.target, mutation.target.data); // Debug: Filter - Mutation text
    if (!Page.isForbiddenNode(mutation.target)) {
      if (filter.mutePage) {
        let supported = filter.audio.supportedNode(mutation.target);
        let rule = supported !== false ? filter.audio.rules[supported] : filter.audio.rules[0]; // Use the matched rule, or the first rule
        if (supported !== false && rule.simpleUnmute) {
          // Supported node. Check if a previously filtered node is being removed
          if (
            filter.audio.muted
            && mutation.oldValue
            && filter.audio.lastFilteredText
            && filter.audio.lastFilteredText.includes(mutation.oldValue)
          ) {
            filter.audio.unmute(rule);
          }
          filter.audio.clean(mutation.target, supported);
        } else if (rule.simpleUnmute && filter.audio.muted && !mutation.target.parentElement) {
          // Check for removing a filtered subtitle (no parent)
          if (filter.audio.lastFilteredText && filter.audio.lastFilteredText.includes(mutation.target.textContent)) {
            filter.audio.unmute(rule);
          }
        } else if (!filter.audioOnly) { // Filter regular text
          let result = this.replaceTextResult(mutation.target.data, this.wordlistId);
          if (result.modified) { mutation.target.data = result.filtered; }
        }
      } else if (!filter.audioOnly) { // Filter regular text
        let result = this.replaceTextResult(mutation.target.data, this.wordlistId);
        if (result.modified) { mutation.target.data = result.filtered; }
      }
    }
    // else { console.log('[APF] Forbidden mutation.target node:', mutation.target); } // Debug: Filter - Mutation text
  }

  cleanAudio(node) {
    // YouTube Auto subs
    if (filter.audio.youTube && filter.audio.youTubeAutoSubsPresent()) {
      if (filter.audio.youTubeAutoSubsSupportedNode(node)) {
        if (filter.audio.youTubeAutoSubsCurrentRow(node)) {
          // console.log('[APF] YouTube subtitle node:', node); // Debug: Audio
          filter.audio.cleanYouTubeAutoSubs(node);
        } else if (!filter.audioOnly) {
          filter.processNode(node, filter.wordlistId); // Clean the rest of the page
        }
      } else if (!filter.audioOnly && !filter.audio.youTubeAutoSubsNodeIsSubtitleText(node)) {
        filter.processNode(node, filter.wordlistId); // Clean the rest of the page
      }
    } else { // Other audio muting
      let supported = filter.audio.supportedNode(node);
      if (supported !== false) {
        // console.log('[APF] Audio subtitle node:', node); // Debug: Audio
        filter.audio.clean(node, supported);
      } else if (!filter.audioOnly) {
        filter.processNode(node, filter.wordlistId); // Clean the rest of the page
      }
    }
  }

  cleanChildNode(node, wordlistId: number, stats: boolean = true) {
    if (node.nodeName) {
      if (node.textContent && node.textContent.trim() != '') {
        let result = this.replaceTextResult(node.textContent, wordlistId, stats);
        if (result.modified) {
          // console.log('[APF] Normal node changed:', result.original, result.filtered); // Debug: Filter - Mutation node filtered
          node.textContent = result.filtered;
        }
      } else if (node.nodeName == 'IMG') {
        if (node.alt != '') { node.alt = this.replaceText(node.alt, wordlistId, stats); }
        if (node.title != '') { node.title = this.replaceText(node.title, wordlistId, stats); }
      } else if (node.shadowRoot) {
        this.filterShadowRoot(node.shadowRoot, wordlistId, stats);
      }
    }
    // else { console.log('[APF] node without nodeName:', node); } // Debug: Filter
  }

  cleanNode(node, wordlistId: number, stats: boolean = true) {
    if (Page.isForbiddenNode(node)) { return false; }
    if (node.shadowRoot) { this.filterShadowRoot(node.shadowRoot, wordlistId, stats); }
    if (node.childNodes.length > 0) {
      for (let i = 0; i < node.childNodes.length ; i++) {
        this.cleanNode(node.childNodes[i], wordlistId, stats);
      }
    } else {
      this.cleanChildNode(node, this.wordlistId, stats);
    }
  }

  async cleanPage() {
    // this.cfg = await WebConfig.build();
    console.timeEnd('loading');
    this.domain = Domain.byHostname(this.hostname, this.cfg.domains);
    // console.log('[APF] Config loaded', this.cfg); // Debug: General

    let backgroundData: BackgroundData = await this.getBackgroundData();

    // Use domain-specific settings
    let message: Message = { disabled: backgroundData.disabledTab || (this.cfg.enabledDomainsOnly && !this.domain.enabled) || this.domain.disabled };
    if (message.disabled) {
      // console.log(`[APF] Disabled page: ${this.hostname} - exiting`); // Debug: General
      chrome.runtime.sendMessage(message);
      return false;
    }
    if (this.domain.wordlistId !== undefined) { this.wordlistId = this.domain.wordlistId; }
    if (this.domain.audioWordlistId !== undefined) { this.audioWordlistId = this.domain.audioWordlistId; }

    // Detect if we should mute audio for the current page
    if (this.cfg.muteAudio) {
      this.audio = new WebAudio(this);
      this.mutePage = this.audio.supportedPage;
      if (this.mutePage) {
        // console.log(`[APF] Enabling audio muting on ${this.hostname}`); // Debug: Audio
        // Prebuild audio wordlist
        if (this.cfg.wordlistsEnabled && this.wordlistId != this.audio.wordlistId) {
          this.wordlists[this.audio.wordlistId] = new Wordlist(this.cfg, this.audio.wordlistId);
        }
      }
    }

    // Disable if muteAudioOnly mode is active and this is not a suported page
    if (this.cfg.muteAudioOnly) {
      if (this.mutePage) {
        this.audioOnly = true;
      } else {
        message.disabled = true;
        // console.log('[APF] Non audio page in audio only mode - exiting'); // Debug: Audio
        chrome.runtime.sendMessage(message);
        return false;
      }
    }

    this.sendInitState(message);
    this.popupListener();

    // Remove profanity from the main document and watch for new nodes
    this.init();
    // console.log('[APF] Filter initialized.', this); // Debug: General
    if (!this.audioOnly) { this.processNode(document, this.wordlistId); }
    this.updateCounterBadge();
    this.startObserving(document);
  }

  cleanText(node, wordlistId: number, stats: boolean = true) {
    if (Page.isForbiddenNode(node)) { return false; }
    if (node.shadowRoot) { this.filterShadowRoot(node.shadowRoot, wordlistId, stats); }
    if (node.childElementCount > 0) {
      let treeWalker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      while(treeWalker.nextNode()) {
        if (treeWalker.currentNode.childNodes.length > 0) {
          treeWalker.currentNode.childNodes.forEach(childNode => {
            this.cleanText(childNode, wordlistId, stats);
          });
        } else {
          if (!Page.isForbiddenNode(treeWalker.currentNode)) {
            this.cleanChildNode(treeWalker.currentNode, wordlistId, stats);
          }
        }
      }
    } else {
      this.cleanChildNode(node, wordlistId, stats);
    }
  }

  filterShadowRoot(shadowRoot: ShadowRoot, wordlistId: number, stats: boolean = true) {
    this.shadowObserver.observe(shadowRoot, ObserverConfig);
    this.processNode(shadowRoot, wordlistId, stats);
  }

  foundMatch(word) {
    super.foundMatch(word);
    if (this.cfg.showSummary) {
      if (this.summary[word.value]) {
        this.summary[word.value].count += 1;
      } else {
        let result;
        if (word.matchMethod === Constants.MatchMethods.Regex) {
          result = word.sub || this.cfg.defaultSubstitution;
        } else {
          result = filter.replaceText(word.value, 0, false); // We can use 0 (All) here because we are just filtering a word
        }

        this.summary[word.value] = { filtered: result, count: 1 };
      }
    }
  }

  getBackgroundData() {
    return new Promise(function(resolve, reject) {
      chrome.runtime.sendMessage({ backgroundData: true }, function(response) {
        if (!response) { response = { disabledTab: false }; }
        resolve(response);
      });
    });
  }

  init(wordlistId: number | false = false) {
    super.init(wordlistId);

    if (this.domain.advanced) {
      this.processNode = this.advancedReplaceText;
    } else if (this.domain.deep) {
      this.processMutationTarget = true;
      this.processNode = this.cleanNode;
    } else {
      this.processNode = this.cleanText;
    }
  }

  // Listen for data requests from Popup
  popupListener() {
    /* istanbul ignore next */
    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse){
      if (filter.cfg.showSummary && request.popup && (filter.counter > 0 || filter.mutePage)) {
        chrome.runtime.sendMessage({ mutePage: filter.mutePage, summary: filter.summary });
      }
    });
  }

  processMutations(mutations) {
    mutations.forEach(function(mutation) {
      filter.checkMutationForProfanity(mutation);
    });
    filter.updateCounterBadge();
  }

  sendInitState(message: Message) {
    // Reset muted state on page load if we muted the tab audio
    if (this.cfg.muteAudio && this.cfg.muteMethod == Constants.MuteMethods.Tab) { message.clearMute = true; }

    // Send page state to color icon badge
    if (!this.iframe) { message.setBadgeColor = true; }
    message.advanced = this.domain.advanced;
    message.mutePage = this.mutePage;
    if (this.mutePage && this.cfg.showCounter) { message.counter = this.counter; } // Always show counter when muting audio
    chrome.runtime.sendMessage(message);
  }

  startObserving(target: Node = document, observer: MutationObserver = filter.observer) {
    observer.observe(target, ObserverConfig);
  }

  stopObserving(observer: MutationObserver = filter.observer) {
    let mutations = observer.takeRecords();
    observer.disconnect();
    if (mutations) { this.processMutations(mutations); }
  }

  updateCounterBadge() {
    /* istanbul ignore next */
    // console.count('updateCounterBadge'); // Benchmark: Filter
    if (this.counter > 0) {
      try {
        if (this.cfg.showCounter) chrome.runtime.sendMessage({ counter: this.counter });
        if (this.cfg.showSummary) chrome.runtime.sendMessage({ summary: this.summary });
      } catch (e) {
        // console.log('Failed to sendMessage', e); // Error - Extension context invalidated.
      }
    }
  }
}

let filter = new WebFilter;
const ObserverConfig: MutationObserverInit = {
  characterData: true,
  characterDataOldValue: true,
  childList: true,
  subtree: true,
};
let port;

if (typeof window !== 'undefined' && ['[object Window]', '[object ContentScriptGlobalScope]'].includes(({}).toString.call(window))) {
  filter.observer = new MutationObserver(filter.processMutations);
  filter.shadowObserver = new MutationObserver(filter.processMutations);

  // The hostname should resolve to the browser window's URI (or the parent of an IFRAME) for disabled/advanced page checks
  if (window != window.top) {
    filter.iframe = document.location;
    try { // same domain
      filter.hostname = window.parent.location.hostname;
    } catch(e) { // different domain
      if (document.referrer) {
        filter.hostname = new URL(document.referrer).hostname;
      } else {
        filter.hostname = document.location.hostname;
      }
    }
  } else {
    filter.hostname = document.location.hostname;
  }

  console.time('loading');

  // Wait for config
  port = chrome.runtime.connect({ name: 'config' });
  port.postMessage({ getConfig: true });
  port.onMessage.addListener(function(msg) {
    // console.log('got response: ', JSON.stringify(msg));
    // if (msg.config) {
    filter.cfg = new WebConfig(msg);
    /* istanbul ignore next */
    filter.cleanPage();
    // }
  });

  // don't cache:
  /* istanbul ignore next */
  // filter.cleanPage();
}
