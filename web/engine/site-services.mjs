import analytics from '../../sites/analytics.json' with {type:'json'};

// Public project IDs and verification files, never authentication credentials.
// Keep these in every release so rebuilding a site cannot remove ownership.
export const verificationFiles={
  'googlec9da0a94ddf2a20d.html':'google-site-verification: googlec9da0a94ddf2a20d.html',
  'BingSiteAuth.xml':'<?xml version="1.0"?>\n<users>\n  <user>DAB1B0176A07FA26EC22A6B9259326F9</user>\n</users>\n'
};
export function clarityScript(site){
  const project=analytics[site.id];if(!project)return '';
  if(!/^[a-z0-9]+$/.test(project))throw Error('Invalid Clarity project');
  const origin=JSON.stringify(new URL(site.origin).origin).replace(/</g,'\\u003c');
  return `<script data-site-analytics="${project}">(function(c,l,a,r,i,t,y){if(location.origin!==${origin}||/^\\/(manage|guestbook)(\\/|$)/.test(location.pathname))return;c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y)})(window,document,"clarity","script","${project}");</script>`;
}
