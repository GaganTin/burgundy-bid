import Home from './pages/Home';
import Authentication from './pages/Authentication';
import Lookup from './pages/Lookup';
import Profile from './pages/Profile';
import Connections from './pages/Connections';
import ContactUs from './pages/ContactUs';
import Workspace from './pages/Workspace';
import TermsOfService from './pages/TermsOfService';
import PrivacyPolicy from './pages/PrivacyPolicy';
// import Docs from './pages/Docs';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Home": Home,
    "Authentication": Authentication,
    "Lookup": Lookup,
    "Profile": Profile,
    "Connections": Connections,
    "ContactUs": ContactUs,
    "Workspace": Workspace,
    "TermsOfService": TermsOfService,
    "PrivacyPolicy": PrivacyPolicy,
    // "Docs": Docs,
}

export const pagesConfig = {
    mainPage: "Home",
    Pages: PAGES,
    Layout: __Layout,
};