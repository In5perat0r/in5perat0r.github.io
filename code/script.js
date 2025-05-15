addEventListener('DOMContentLoaded', event => {
    document.querySelectorAll('pre[script] > code').forEach(item => {
        let name = item.parentElement.getAttribute('script');
        fetch(`https://in5perat0r.github.io/userscripts/${name}`).then(response => {
            response.text().then(txt => {
                let extension = name.substring(name.lastIndexOf('.')+1);
                item.innerHTML = txt;
                item.classList.add(`language-${extension}`);
            })
        })
    })
})