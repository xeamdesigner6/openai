import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { ConsolePage } from './pages/ConsolePage';
import ScenarioForm from './pages/FormPage';
import './App.scss';
import { ConsolePageNew } from './pages/ConsolePageNew';

function App() {
  return (
    <div data-component="App">
      <Router>
        <Routes>
          {/* Define routes for different pages */}
          <Route path="/" element={<ConsolePage />} />
          <Route path="/form" element={<ScenarioForm />} />
          <Route path="/console" element={<ConsolePageNew />} />
        </Routes>
      </Router>
    </div>
  );
}

export default App;
