document.createElementAttr = function(tagName, attr) {
    let e = document.createElement(tagName);
    let attrList = Object.entries(attr);
    attrList.forEach(item => {
        if (item[0] == 'innerText') {
            e.innerText = item[1];
        } else if (item[0] == 'innerHTML') {
            e.innerHTML = item[1];
        } else {
            e.setAttribute(item[0], item[1]);
        }
    });
    return e;
}

window.appendChildChain = function(tbl) {
    tbl.reverse();
    tbl = tbl.map((item, index, parent) => {
        return [tbl[index], tbl[index+1]];
    });
    tbl.pop();
    tbl.forEach((entry, index, parent) => {
        entry[1].appendChild(entry[0]);
    })
}

window.addCSS = function(cssStyle) {
    let styleElement = document.createElementAttr('style', {id: 'data-css', innerHTML: cssStyle});
    document.head.appendChild(styleElement);
}

window.addStylesheet = function(relative_path) {
    let stylesheet = document.createElementAttr('link', {rel: 'stylesheet', href: relative_path});
    document.head.appendChild(stylesheet);
}

function oMap(obj, callback) {
    return callback(obj);
}

function toggleCheckbox(e) {
    if (e.classList.contains('active')) {
        e.classList.remove('active');
    } else if (!e.classList.contains('active')) {
        e.classList.add('active');
    }
}

function navigatePage(rawUrl) {
    let url = new URL(rawUrl);
    let idMatch = /(#)?(?<id>.+)/gm;
    let matchData = Array.from(url.hash.matchAll(idMatch));
    if (matchData.length != 0) {
        let id = matchData[0].groups.id;
        if (!existsPart(id)) return;
        focusPart(id);
        focusEntry(id);
    }
}

function isEmpty(value) {
    var result = true;
    var emptyMatch = RegExp(/((^\s+$)|^$)/mg);
    if (value.match(emptyMatch)) {
        result = false;
    }
    return !result;
}

function isValid(value) {
    if (isEmpty(value)) {
        return false;
    }
    if (isNaN(parseInt(value))) {
        return false;
    }
    return true;
}

function isValidNumber(value) {
    if (isNaN(parseInt(value))) {
        return false;
    }
    return true;
}

function clearEmptySpace(value) {
    var onlyText = Regex(/^\s+?(.+)\s+?/mg);
    return value;
}

function existsPart(id) {
    return Array.from(document.querySelectorAll('#pageViews > *')).some(view => 
        view.getAttribute('id') === id
    );
}

function focusPart(id) {
    document.querySelectorAll('#pageViews > *').forEach(view => {
        if (view.getAttribute('id') == id) {
            if (!view.classList.contains('show')) view.classList.add('show');
        } else {
            if (view.classList.contains('show')) view.classList.remove('show');
        }
    })
}

function focusEntry(id) {
    $('#sidebar > *').each((_, ientry) => {
        if (ientry.getAttribute('data-id') == id) {
            if (!ientry.classList.contains('focused')) ientry.classList.add('focused');
        } else {
            if (ientry.classList.contains('focused')) ientry.classList.remove('focused');
        }
    })
}

function focusRegister(id) {
    focusPart(id);
    focusEntry(id);
}

function toggleCheckbox(e) {
    if (e.classList.contains('active')) {
        e.classList.remove('active');
    } else if (!e.classList.contains('active')) {
        e.classList.add('active');
    }
}

function registerSidebarContent() {
    document.querySelectorAll('#sidebar > *').forEach(entry => {
        entry.addEventListener('click', e => {
            focusPart(entry.getAttribute('data-id'));
            focusEntry(entry.getAttribute('data-id'));
            document.querySelector('#sidebar').classList.remove('show');
        })
    })
}

// DOMContentLoaded Event
document.addEventListener("DOMContentLoaded", e => {
    
    document.querySelector('#sidemenu').addEventListener('click', element => {
        if (!document.querySelector('#sidebar').classList.contains('show')) {
            document.querySelector('#sidebar').classList.add('show');
        } else {
            document.querySelector('#sidebar').classList.remove('show');
        }
    });

    document.querySelectorAll('.navBtn').forEach(item => {
        item.addEventListener('click', ev => {
            var url = item.getAttribute('href');
            window.open(url, '_self');
            //document.location.replace(url);
        });
    });

    $('.custom-checkbox').on('click', (e) => {
        toggleCheckbox(e.currentTarget);
        toggleFields(e.currentTarget);
    });
    
});

function loadData() {
    fetch('file:///C:/Users/schlacht/Documents/IT-Archive/index/content/data.json').then(response => {
        response.json().then(data => {
            let sidebar = document.querySelector('#sidebar');
            let viewpane = document.querySelector('#pageViews');
            let indexPage = viewpane.querySelector('#index');
            let indexList = indexPage.querySelector('div > div > table > tbody');
            let hasFocused = data.panes.map(pane => pane.focused).includes(true);
            addStylesheet('content/data.css');
            data.panes.forEach((item, index, parent) => {
                let sidebarEntry = document.createElementAttr('div', {'data-id': item.paneId, class: ('sideItem'+(item.wip?' niu':'')+(item.focused?' focused':''))});
                let pageViewEntry = document.createElementAttr('div', {id: item.paneId, class: ('content-pane'+(item.focused?' show':''))});
                let sidebarTextEntry = document.createElementAttr('p', {innerText: item.sidebarName});
                sidebarEntry.appendChild(sidebarTextEntry);
                sidebar.appendChild(sidebarEntry);
                viewpane.appendChild(pageViewEntry);
                if (item.html) pageViewEntry.innerHTML = item.html.join('\n');
                let tr = document.createElement('tr');
                let td = document.createElement('td');
                let row_content = document.createElementAttr('div', {class: 'navBtn', 'data-id': `id${index+1}`});
                let row_text = document.createElementAttr('span', {class: 'bold', innerText: item.sidebarName});
                appendChildChain([indexList, tr, td, row_content, row_text]);
            })
            if (!hasFocused) sidebar.querySelector('div[data-id=index]').classList.add('focused');
            if (!hasFocused) indexPage.classList.add('show');
            registerSidebarContent();
            navigatePage(document.URL);
        })
    })
}