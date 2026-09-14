(async function () {
  const DATA_URL = "data.json";

  const titleEl = document.getElementById("drawer-title");
  const countEl = document.getElementById("entry-count");
  const listEl = document.getElementById("card-list");
  const emptyEl = document.getElementById("empty-state");

  function catalogNumber(index) {
    return "0x" + (index + 1).toString(16).padStart(2, "0").toUpperCase();
  }

  function buildCard(entry, index) {
    const li = document.createElement("li");
    li.className = "card";
    li.style.setProperty("--delay", index * 0.06 + "s");

    const link = document.createElement("a");
    link.className = "card__link";
    link.href = entry.sub_index;

    const tab = document.createElement("span");
    tab.className = "card__tab";
    tab.textContent = catalogNumber(index);
    tab.setAttribute("aria-hidden", "true");

    const body = document.createElement("span");
    body.className = "card__body";

    const title = document.createElement("span");
    title.className = "card__title";
    title.textContent = entry.title;

    const path = document.createElement("span");
    path.className = "card__path";
    path.textContent = entry.sub_index;

    body.appendChild(title);
    body.appendChild(path);
    link.appendChild(tab);
    link.appendChild(body);
    li.appendChild(link);

    return li;
  }

  function render(data) {
    document.title = data.header || "Index";
    titleEl.textContent = data.header || "Index";

    const entries = Array.isArray(data.entries) ? data.entries : [];
    countEl.textContent = String(entries.length);

    if (entries.length === 0) {
      emptyEl.hidden = false;
      return;
    }

    const fragment = document.createDocumentFragment();
    entries.forEach((entry, index) => {
      fragment.appendChild(buildCard(entry, index));
    });
    listEl.appendChild(fragment);
  }

  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }
    const data = await response.json();
    render(data);
  } catch (err) {
    titleEl.textContent = "Index";
    emptyEl.hidden = false;
    emptyEl.textContent = "data.json konnte nicht geladen werden (" + err.message + ").";
    console.error("Fehler beim Laden von data.json:", err);
  }
})();