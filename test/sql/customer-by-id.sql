SELECT customer_id, customer, credit
FROM customer
WHERE customer_id = $customer_id
  AND valid_to = '9999-12-31';
