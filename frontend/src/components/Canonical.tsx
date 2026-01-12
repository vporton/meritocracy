import { Helmet } from "react-helmet-async";
import { useLocation } from "react-router-dom";

const Canonical = ({ baseUrl }) => {
    const { pathname, search } = useLocation();

    const canonicalUrl = `${baseUrl}${pathname}${search}`;

    return (
        <Helmet>
            <link rel="canonical" href={canonicalUrl} />
        </Helmet>
    );
};

export default Canonical;