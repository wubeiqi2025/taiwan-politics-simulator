import { render } from 'preact';
import './styles.css';
import { App } from './App.jsx';
import { boot } from './core/store.js';

render(<App />, document.getElementById('app'));
boot();
