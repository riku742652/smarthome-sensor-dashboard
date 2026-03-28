include "root" {
  path = find_in_parent_folders()
}

terraform {
  source = "../../../modules/cloudfront"
}

inputs = {
  price_class        = "PriceClass_200"  # US, Europe, Asia, Middle East, Africa
  default_cache_ttl  = 3600              # 1 hour
  max_cache_ttl      = 86400             # 24 hours
}
