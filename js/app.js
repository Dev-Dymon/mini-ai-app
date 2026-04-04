/**
 * NeuralPrompt — app.js
 *
 * Frontend-only AI prompt app. Works on GitHub Pages (no backend).
 * HF token stored in localStorage — never hardcoded.
 * Two-page flow: index.html → result.html
 */

(function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /*  Constants                                                           */
  /* ------------------------------------------------------------------ */

  var HF_API_URL  = "https://router.huggingface.co/v1/chat/completions";
  var HF_MODEL    = "meta-llama/Llama-3.1-8B-Instruct";
  var TOKEN_KEY   = "np_hf_token";   // localStorage key for the HF token
  var PROMPT_KEY  = "np_prompt";     // sessionStorage key for last prompt
  var RESPONSE_KEY = "np_response";  // sessionStorage key for last response

  /* ------------------------------------------------------------------ */
  /*  Service Worker registration                                         */
  /*  Uses relative path so it works at any GitHub Pages subdirectory.   */
  /* ------------------------------------------------------------------ */

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      /* Derive the base path of the current page so the SW scope is correct */
      var swPath = (function () {
        var scripts = document.querySelectorAll("script[src]");
        for (var i = 0; i < scripts.length; i++) {
          var src = scripts[i].getAttribute("src");
          if (src && src.indexOf("app.js") !== -1) {
            /* app.js is in js/, so service-worker.js is one level up */
            return src.replace("js/app.js", "service-worker.js");
          }
        }
        return "service-worker.js"; /* fallback */
      })();

      navigator.serviceWorker
        .register(swPath, { scope: "./" })
        .then(function (reg) {
          console.log("[SW] Registered, scope:", reg.scope);
        })
        .catch(function (err) {
          console.warn("[SW] Registration failed:", err);
        });
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Token helpers                                                       */
  /* ------------------------------------------------------------------ */

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function saveToken(token) {
    localStorage.setItem(TOKEN_KEY, token.trim());
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
  }

  /* ------------------------------------------------------------------ */
  /*  Utility helpers                                                     */
  /* ------------------------------------------------------------------ */

  function escapeHtml(str) {
    var map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return str.replace(/[&<>"']/g, function (ch) { return map[ch]; });
  }

  function parseInline(line) {
    return line
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g,     "<em>$1</em>")
      .replace(/`([^`]+)`/g,     "<code>$1</code>");
  }

  function formatResponse(text) {
    var blocks = text.split(/\n{2,}/);
    var html = "";

    blocks.forEach(function (block) {
      block = block.trim();
      if (!block) return;

      var lines = block.split("\n");

      var isNumbered = lines.every(function (l) {
        return /^\d+\.\s/.test(l.trim()) || l.trim() === "";
      });
      var isBullet = !isNumbered && lines.every(function (l) {
        return /^[-*]\s/.test(l.trim()) || l.trim() === "";
      });

      if (isNumbered) {
        html += "<ol>";
        lines.forEach(function (l) {
          l = l.trim();
          if (!l) return;
          html += "<li>" + parseInline(escapeHtml(l.replace(/^\d+\.\s*/, ""))) + "</li>";
        });
        html += "</ol>";
      } else if (isBullet) {
        html += "<ul>";
        lines.forEach(function (l) {
          l = l.trim();
          if (!l) return;
          html += "<li>" + parseInline(escapeHtml(l.replace(/^[-*]\s*/, ""))) + "</li>";
        });
        html += "</ul>";
      } else {
        var inner = lines.map(function (l) {
          return parseInline(escapeHtml(l));
        }).join("<br />");
        html += "<p>" + inner + "</p>";
      }
    });

    return html;
  }

  /* ------------------------------------------------------------------ */
  /*  Token Modal                                                         */
  /* ------------------------------------------------------------------ */

  function initTokenModal() {
    var modal     = document.getElementById("tokenModal");
    var input     = document.getElementById("tokenInput");
    var saveBtn   = document.getElementById("saveTokenBtn");
    var showChk   = document.getElementById("showToken");
    var errBanner = document.getElementById("tokenErrorMsg");

    if (!modal) return;   /* modal only exists on index.html */

    /* Toggle password visibility */
    if (showChk && input) {
      showChk.addEventListener("change", function () {
        input.type = this.checked ? "text" : "password";
      });
    }

    /* Pre-fill if token already exists (editing via settings button) */
    function openModal(prefill) {
      if (input) input.value = prefill ? getToken() : "";
      if (errBanner) {
        errBanner.textContent = "";
        errBanner.classList.add("d-none");
      }
      modal.classList.add("is-open");
      if (input) setTimeout(function () { input.focus(); }, 120);
    }

    function closeModal() {
      modal.classList.remove("is-open");
    }

    /* Save button */
    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        var val = (input ? input.value : "").trim();
        if (!val || !val.startsWith("hf_")) {
          if (errBanner) {
            errBanner.textContent = "Please enter a valid Hugging Face token (starts with hf_).";
            errBanner.classList.remove("d-none");
          }
          return;
        }
        saveToken(val);
        closeModal();
      });
    }

    /* Enter key in input */
    if (input) {
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") saveBtn && saveBtn.click();
      });
    }

    /* Settings button re-opens the modal */
    var settingsBtn = document.getElementById("settingsBtn");
    if (settingsBtn) {
      settingsBtn.addEventListener("click", function () {
        openModal(true);
      });
    }

    /* Show modal on first load if no token */
    if (!getToken()) {
      openModal(false);
    }

    /* Expose openModal so index page can call it if needed */
    return { openModal: openModal };
  }

  /* ------------------------------------------------------------------ */
  /*  INDEX PAGE — prompt submission                                      */
  /* ------------------------------------------------------------------ */

  function initIndexPage() {
    var promptInput = document.getElementById("promptInput");
    var submitBtn   = document.getElementById("submitBtn");
    var charCount   = document.getElementById("charCount");
    var errorMsg    = document.getElementById("errorMsg");

    if (!promptInput || !submitBtn) return;

    /* Token modal setup */
    var modal = initTokenModal();

    /* Character counter */
    promptInput.addEventListener("input", function () {
      var len = this.value.length;
      charCount.textContent = len + " / 1200";
      charCount.style.color = len > 1100 ? "var(--accent-rose)" : "";
    });

    /* Submit handlers */
    submitBtn.addEventListener("click", handleSubmit);
    promptInput.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") handleSubmit();
    });

    function showError(msg) {
      errorMsg.textContent = msg;
      errorMsg.classList.remove("d-none");
    }

    function hideError() {
      errorMsg.classList.add("d-none");
      errorMsg.textContent = "";
    }

    function setLoading(isLoading) {
      var label   = submitBtn.querySelector(".btn-label");
      var arrow   = submitBtn.querySelector(".btn-arrow");
      var spinner = submitBtn.querySelector(".btn-spinner");

      submitBtn.disabled = isLoading;

      if (isLoading) {
        label.textContent = "Thinking\u2026";
        arrow.classList.add("d-none");
        spinner.classList.remove("d-none");
      } else {
        label.textContent = "Ask the AI";
        arrow.classList.remove("d-none");
        spinner.classList.add("d-none");
      }
    }

    async function handleSubmit() {
      hideError();

      /* Check token first */
      var token = getToken();
      if (!token) {
        if (modal) modal.openModal(false);
        return;
      }

      var prompt = promptInput.value.trim();

      if (!prompt) {
        showError("Please enter a prompt before submitting.");
        promptInput.focus();
        return;
      }

      if (prompt.length > 1200) {
        showError("Your prompt exceeds 1200 characters. Please shorten it.");
        return;
      }

      setLoading(true);

      try {
        var response = await fetch(HF_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
          },
          body: JSON.stringify({
            model: HF_MODEL,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 2000
          })
        });

        if (response.status === 401) {
          /* Bad token — clear it and prompt again */
          clearToken();
          setLoading(false);
          showError("Your API token was rejected. Please update it and try again.");
          if (modal) modal.openModal(false);
          return;
        }

        if (!response.ok) {
          var errData = await response.json().catch(function () { return {}; });
          throw new Error(
            (errData.error && errData.error.message) ||
            "API error \u2014 status " + response.status
          );
        }

        var data   = await response.json();
        var aiText = data.choices &&
                     data.choices[0] &&
                     data.choices[0].message &&
                     data.choices[0].message.content;

        if (!aiText || !aiText.trim()) {
          throw new Error("No response received from the AI. Please try again.");
        }

        /* Persist and navigate */
        sessionStorage.setItem(PROMPT_KEY,   prompt);
        sessionStorage.setItem(RESPONSE_KEY, aiText.trim());
        window.location.href = "result.html";

      } catch (err) {
        setLoading(false);
        var msg = err.message || "An unexpected error occurred.";
        if (msg.toLowerCase().indexOf("failed to fetch") !== -1) {
          msg = "Network error \u2014 check your internet connection and try again.";
        }
        showError(msg);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  RESULT PAGE — display response                                      */
  /* ------------------------------------------------------------------ */

  function initResultPage() {
    var displayPrompt   = document.getElementById("displayPrompt");
    var displayResponse = document.getElementById("displayResponse");
    var copyBtn         = document.getElementById("copyBtn");

    if (!displayPrompt || !displayResponse) return;

    var prompt   = sessionStorage.getItem(PROMPT_KEY);
    var response = sessionStorage.getItem(RESPONSE_KEY);

    /* Guard: if no data, send back */
    if (!prompt || !response) {
      window.location.href = "index.html";
      return;
    }

    /* Render */
    displayPrompt.textContent    = prompt;
    displayResponse.innerHTML    = formatResponse(response);

    /* Copy to clipboard */
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(response).then(flashCopied).catch(function () {
            fallbackCopy(response);
          });
        } else {
          fallbackCopy(response);
        }
      });
    }

    function flashCopied() {
      copyBtn.classList.add("copied");
      copyBtn.innerHTML = '<span class="copy-icon">\u2713</span> Copied';
      setTimeout(function () {
        copyBtn.classList.remove("copied");
        copyBtn.innerHTML = '<span class="copy-icon">\u29c9</span> Copy';
      }, 2200);
    }

    function fallbackCopy(text) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity  = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); flashCopied(); } catch (e) {}
      document.body.removeChild(ta);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Router                                                              */
  /* ------------------------------------------------------------------ */

  var path = window.location.pathname;

  if (path.indexOf("result.html") !== -1) {
    initResultPage();
  } else {
    initIndexPage();
  }

})();
