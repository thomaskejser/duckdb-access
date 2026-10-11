CREATE SEQUENCE customer_seq;

CREATE TABLE customer (
    customer_id BIGINT  NOT NULL PRIMARY KEY DEFAULT nextval('customer_seq'),
    customer    TEXT    NOT NULL DEFAULT '',
    credit      DECIMAL(18, 2) NOT NULL DEFAULT 0,
    valid_to    DATE    NOT NULL DEFAULT '9999-12-31'
);

INSERT INTO customer (customer, credit) VALUES ('Acme', 10.50), ('Globex', 0);
