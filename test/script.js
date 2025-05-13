function appendURLPath(url, value) {
    let u = new URL(url);
    u.pathname = u.pathname + value;
    return u.toString();
}

addEventListener('DOMContentLoaded', e => {
    'https://in5perat0r.github.io/test/content/New%20Text%20File%20(1).txt'
    let baseURL = 'https://in5perat0r.github.io/test';
    fetch(baseURL + '/index.json').then(response => {
        response.json().then(content => {
            let ls = [];
            content.forEach(v => {
                ls.push(appendURLPath(baseURL, '/content/' + v));
            });
            console.log(ls);
        })
    })
})