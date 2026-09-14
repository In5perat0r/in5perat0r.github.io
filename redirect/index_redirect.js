(function () {
  const input = document.getElementById("url-input");
  const validateCheckbox = document.getElementById("validate-checkbox");

  const btnSelf = document.getElementById("open-self");
  const btnTab = document.getElementById("open-tab");
  const btnWindow = document.getElementById("open-window");

  const dialog = document.getElementById("invalid-dialog");
  const dialogMessage = document.getElementById("invalid-dialog-message");
  const dialogClose = document.getElementById("dialog-close");

  // Only http:// and https:// count as valid when validation is enabled.
  // Anything else (chrome://, about:, javascript:, plain text, etc.) is rejected.
  const VALID_URL_PATTERN = /^https?:\/\/.+/i;

  function showDialog(message) {
    dialogMessage.textContent = message;
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      // Fallback for browsers without <dialog> support.
      window.alert(message);
    }
  }

  function getUrl() {
    return input.value.trim();
  }

  function isValid(url) {
    return VALID_URL_PATTERN.test(url);
  }

  // Returns the URL to open, or null if it should not be opened
  // (and shows the appropriate dialog itself).
  function resolveUrl() {
    const url = getUrl();

    if (!url) {
      showDialog("Please enter a URL first.");
      return null;
    }

    if (validateCheckbox.checked && !isValid(url)) {
      showDialog("This URL is invalid. It must start with http:// or https://.");
      return null;
    }

    return url;
  }

  btnSelf.addEventListener("click", function () {
    const url = resolveUrl();
    if (url) {
      window.location.href = url;
    }
  });

  btnTab.addEventListener("click", function () {
    const url = resolveUrl();
    if (url) {
      window.open(url, "_blank", "noopener");
    }
  });

  btnWindow.addEventListener("click", function () {
    const url = resolveUrl();
    if (url) {
      // Explicit size/feature string signals the browser to open a
      // separate window rather than a tab. Some browsers may still use
      // a tab depending on user settings; this is outside page control.
      window.open(url, "_blank", "noopener,width=900,height=700,left=100,top=100");
    }
  });

  dialogClose.addEventListener("click", function () {
    dialog.close();
  });

  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      btnSelf.click();
    }
  });
})();